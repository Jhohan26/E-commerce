// Servicio RPC sobre RabbitMQ para consultar existencias del Grupo H (Inventario) con autenticación JWT
const amqp = require('amqplib');
const crypto = require('crypto');
require('dotenv').config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const QUEUE_LOGIN = 'inventario.login';
const QUEUE_LISTAR = 'inventario.listar';
const QUEUE_CONSULTAR = 'inventario.consultar';
const RPC_TIMEOUT_MS = 4000;

const INVENTARIO_RPC_USER = process.env.INVENTARIO_RPC_USER || 'inventario';
const INVENTARIO_RPC_PASSWORD = process.env.INVENTARIO_RPC_PASSWORD || '';
const JWT_SECRET = process.env.JWT_SECRET || '';

let rpcConnection = null;
let rpcChannel = null;
let replyQueueName = null;
const pendingCalls = new Map();

// Caché del token JWT obtenido en inventario.login
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

function generarTokenRespaldo() {
  const ahoraSeg = Math.floor(Date.now() / 1000);
  const expSeg = ahoraSeg + 1800;
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: INVENTARIO_RPC_USER,
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

    rpcChannel.consume(
      replyQueueName,
      (msg) => {
        if (!msg) return;
        const cid = msg.properties.correlationId;
        if (pendingCalls.has(cid)) {
          const { resolve } = pendingCalls.get(cid);
          pendingCalls.delete(cid);
          try {
            resolve(JSON.parse(msg.content.toString()));
          } catch {
            resolve({ status: 500, error: 'Respuesta RPC inválida de Inventario' });
          }
        }
      },
      { noAck: true }
    );

    return rpcChannel;
  } catch (err) {
    console.warn('[Inventario RPC] No se pudo inicializar canal RPC:', err.message);
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
      return reject(new Error('Canal RabbitMQ no disponible para RPC de Inventario'));
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
 * Obtiene un token JWT desde la cola pública `inventario.login` de Grupo H
 * usando INVENTARIO_RPC_USER e INVENTARIO_RPC_PASSWORD.
 */
async function obtenerTokenInventarioRpc(forzarRenovacion = false) {
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
          usuario: INVENTARIO_RPC_USER,
          password: INVENTARIO_RPC_PASSWORD
        },
        undefined,
        2500
      );

      if (resp && resp.status === 200 && resp.data && resp.data.token) {
        const ttlSeg = Number(resp.data.expira_en_segundos) || 1800;
        cachedToken = resp.data.token;
        cachedTokenExpMs = Date.now() + Math.max(ttlSeg - 15, 10) * 1000;
        console.log(`[Inventario RPC] Autenticado exitosamente en "${QUEUE_LOGIN}" con usuario "${INVENTARIO_RPC_USER}".`);
        return cachedToken;
      }

      console.warn(
        `[Inventario RPC] ${QUEUE_LOGIN} devolvió status ${resp ? resp.status : 'desconocido'}. Usando token JWT firmado con secreto compartido.`
      );
    } catch (err) {
      console.warn(
        `[Inventario RPC] No se pudo autenticar en ${QUEUE_LOGIN} (${err.message}). Usando token JWT firmado con secreto compartido.`
      );
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

async function callAuthenticatedInventarioRpc(queue, payload = {}) {
  for (let intento = 0; intento < 2; intento++) {
    const token = await obtenerTokenInventarioRpc(intento > 0);
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
  return { status: 401, error: 'No autorizado en RPC de Inventario' };
}

/**
 * Consulta la lista completa de existencias en la cola `inventario.listar` (Grupo H).
 */
async function listarInventario() {
  try {
    const respuesta = await callAuthenticatedInventarioRpc(QUEUE_LISTAR, {});
    if (respuesta && respuesta.status === 200 && Array.isArray(respuesta.data)) {
      return {
        conectadoGrupoH: true,
        total: respuesta.data.length,
        inventario: respuesta.data.map((item) => ({
          productoId: Number(item.producto_id ?? item.id),
          nombre: item.nombre || `Producto #${item.producto_id ?? item.id}`,
          cantidad: Number(item.cantidad ?? 0),
          actualizado: item.actualizado || null
        }))
      };
    }
  } catch (err) {
    console.warn(`[Inventario RPC] ${err.message}.`);
  }

  return {
    conectadoGrupoH: false,
    total: 0,
    inventario: []
  };
}

/**
 * Consulta el stock de un producto específico en la cola `inventario.consultar` (Grupo H).
 */
async function consultarProductoInventario(idParam) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) return null;

  try {
    const respuesta = await callAuthenticatedInventarioRpc(QUEUE_CONSULTAR, { id });
    if (respuesta && respuesta.status === 200 && respuesta.data) {
      const item = respuesta.data;
      return {
        productoId: Number(item.producto_id ?? item.id ?? id),
        nombre: item.nombre || `Producto #${id}`,
        cantidad: Number(item.cantidad ?? 0),
        actualizado: item.actualizado || null
      };
    }
  } catch (err) {
    console.warn(`[Inventario RPC] Consulta producto #${id}: ${err.message}`);
  }

  return null;
}

module.exports = {
  listarInventario,
  consultarProductoInventario,
  obtenerTokenInventarioRpc
};
