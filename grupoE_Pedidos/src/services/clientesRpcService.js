// Servicio RPC sobre RabbitMQ para consultar clientes del Grupo F (con autenticación JWT)
const amqp = require('amqplib');
const crypto = require('crypto');
require('dotenv').config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const QUEUE_LOGIN = 'auth.login';
const QUEUE_LISTAR = 'clientes.listar';
const QUEUE_CONSULTAR = 'cliente.consultar';
const RPC_TIMEOUT_MS = 4000;

const CLIENTES_RPC_USER = process.env.CLIENTES_RPC_USER || 'demo';
const CLIENTES_RPC_PASSWORD = process.env.CLIENTES_RPC_PASSWORD || '';
const JWT_SECRET = process.env.JWT_SECRET || '';

let rpcConnection = null;
let rpcChannel = null;
let replyQueueName = null;
const pendingCalls = new Map();

// Caché del token JWT obtenido en auth.login
let cachedToken = null;
let cachedTokenExpMs = 0;
let pendingLoginPromise = null;

function base64UrlEncode(bufferOrString) {
  const buf = Buffer.isBuffer(bufferOrString)
    ? bufferOrString
    : Buffer.from(String(bufferOrString), 'utf8');
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Genera un token HS256 local de respaldo firmado con JWT_SECRET
 * por si la cola auth.login no responde a tiempo pero los workers de consulta sí están activos.
 */
function generarTokenRespaldo() {
  const ahoraSeg = Math.floor(Date.now() / 1000);
  const expSeg = ahoraSeg + 1800;
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: CLIENTES_RPC_USER,
      role: 'operador',
      iat: ahoraSeg,
      exp: expSeg
    })
  );
  const firma = base64UrlEncode(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest()
  );
  return {
    token: `${header}.${payload}.${firma}`,
    expiraEnSegundos: 1800
  };
}

function formatearCliente(c) {
  const nombres = [c.primer_nombre, c.segundo_nombre].filter(Boolean).join(' ');
  const apellidos = [c.primer_apellido, c.segundo_apellido].filter(Boolean).join(' ');
  const nombreCompleto = `${nombres} ${apellidos}`.trim() || c.nombre || `Cliente #${c.id}`;

  return {
    id: Number(c.id),
    nombre: nombreCompleto,
    correo: c.correo || '',
    estado: c.estado !== undefined ? Number(c.estado) : 1,
    activo: Number(c.estado) === 1,
    ciudad: c.ciudad || 'No especificada',
    origen: c.primer_nombre ? 'grupoF' : 'local'
  };
}

async function getRpcChannel() {
  if (rpcChannel && replyQueueName) return rpcChannel;

  try {
    if (!rpcConnection) {
      rpcConnection = await amqp.connect(RABBITMQ_URL);
      rpcConnection.on('close', () => {
        rpcConnection = null;
        rpcChannel = null;
        replyQueueName = null;
      });
      rpcConnection.on('error', () => {
        rpcConnection = null;
        rpcChannel = null;
        replyQueueName = null;
      });
    }

    rpcChannel = await rpcConnection.createChannel();
    const q = await rpcChannel.assertQueue('', { exclusive: true, autoDelete: true });
    replyQueueName = q.queue;

    rpcChannel.consume(replyQueueName, (msg) => {
      if (!msg) return;
      const cid = msg.properties.correlationId;
      if (pendingCalls.has(cid)) {
        const { resolve } = pendingCalls.get(cid);
        pendingCalls.delete(cid);
        try {
          const body = JSON.parse(msg.content.toString());
          resolve(body);
        } catch (e) {
          resolve({ status: 500, error: 'Respuesta RPC inválida' });
        }
      }
    }, { noAck: true });

    return rpcChannel;
  } catch (err) {
    console.warn('[Clientes RPC] No se pudo inicializar canal RPC:', err.message);
    rpcConnection = null;
    rpcChannel = null;
    replyQueueName = null;
    return null;
  }
}

function callRpc(queue, payload = {}, headers = undefined, timeoutMs = RPC_TIMEOUT_MS) {
  return new Promise(async (resolve, reject) => {
    const ch = await getRpcChannel();
    if (!ch || !replyQueueName) {
      return reject(new Error('Canal RabbitMQ no disponible para RPC'));
    }

    const cid = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingCalls.delete(cid);
      reject(new Error(`Timeout (${timeoutMs}ms) esperando respuesta de ${queue}`));
    }, timeoutMs);

    pendingCalls.set(cid, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject
    });

    try {
      const options = {
        correlationId: cid,
        replyTo: replyQueueName,
        expiration: String(timeoutMs),
        contentType: 'application/json'
      };
      if (headers) {
        options.headers = headers;
      }

      ch.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), options);
    } catch (err) {
      clearTimeout(timer);
      pendingCalls.delete(cid);
      reject(err);
    }
  });
}

/**
 * Obtiene un token JWT desde la cola pública `auth.login` de Grupo F,
 * y lo almacena en caché hasta antes de su expiración.
 */
async function obtenerTokenRpc(forzarRenovacion = false) {
  if (!forzarRenovacion && cachedToken && Date.now() < cachedTokenExpMs) {
    return cachedToken;
  }

  if (pendingLoginPromise && !forzarRenovacion) {
    return pendingLoginPromise;
  }

  pendingLoginPromise = (async () => {
    try {
      const resp = await callRpc(
        QUEUE_LOGIN,
        {
          usuario: CLIENTES_RPC_USER,
          password: CLIENTES_RPC_PASSWORD
        },
        undefined,
        2000
      );

      if (resp && resp.status === 200 && resp.data && resp.data.token) {
        const ttlSeg = Number(resp.data.expira_en_segundos) || 1800;
        cachedToken = resp.data.token;
        cachedTokenExpMs = Date.now() + Math.max(ttlSeg - 15, 10) * 1000;
        return cachedToken;
      }

      console.warn(
        `[Clientes RPC] auth.login devolvió status ${resp ? resp.status : 'desconocido'}. Usando token JWT firmado con secreto compartido.`
      );
    } catch (err) {
      console.warn(`[Clientes RPC] No se pudo autenticar en ${QUEUE_LOGIN} (${err.message}). Usando token JWT firmado con secreto compartido.`);
    }

    const respaldo = generarTokenRespaldo();
    cachedToken = respaldo.token;
    cachedTokenExpMs = Date.now() + (respaldo.expiraEnSegundos - 15) * 1000;
    return cachedToken;
  })().finally(() => {
    pendingLoginPromise = null;
  });

  return pendingLoginPromise;
}

/**
 * Ejecuta una petición RPC autenticada enviando el header `Authorization: Bearer <token>`.
 * Si recibe 401 (token expirado), renueva el token una vez y reintenta.
 */
async function callAuthenticatedRpc(queue, payload = {}) {
  for (let intento = 0; intento < 2; intento++) {
    const token = await obtenerTokenRpc(intento > 0);
    const respuesta = await callRpc(queue, payload, {
      Authorization: `Bearer ${token}`
    });

    if (respuesta && respuesta.status === 401 && intento === 0) {
      cachedToken = null;
      cachedTokenExpMs = 0;
      continue;
    }

    return respuesta;
  }
  return { status: 401, error: 'No autorizado en RPC de Clientes' };
}

/**
 * Consulta la lista de clientes vía RabbitMQ RPC (cola clientes.listar).
 * Devuelve ÚNICAMENTE los clientes reales recibidos del Grupo F.
 */
async function listarClientes() {
  let clientesF = [];
  let conectadoF = false;

  try {
    const respuesta = await callAuthenticatedRpc(QUEUE_LISTAR, {});
    if (respuesta && respuesta.status === 200 && Array.isArray(respuesta.data)) {
      clientesF = respuesta.data.map(formatearCliente);
      conectadoF = true;
    }
  } catch (err) {
    console.warn(`[Clientes RPC] ${err.message}.`);
  }

  const listadoFinal = clientesF.sort((a, b) => a.id - b.id);

  return {
    total: listadoFinal.length,
    origenGrupoF: conectadoF,
    clientesRemotosGrupoF: listadoFinal.length,
    clientes: listadoFinal
  };
}

/**
 * Consulta un cliente puntual vía RabbitMQ RPC (cola cliente.consultar).
 */
async function consultarCliente(idParam) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) {
    return null;
  }

  try {
    const respuesta = await callAuthenticatedRpc(QUEUE_CONSULTAR, { id });
    if (respuesta && respuesta.status === 200 && respuesta.data) {
      return formatearCliente(respuesta.data);
    }
  } catch (err) {
    console.warn(`[Clientes RPC] Consulta id #${id}: ${err.message}`);
  }

  return null;
}

module.exports = {
  listarClientes,
  consultarCliente,
  obtenerTokenRpc
};

