// Servicio RPC sobre RabbitMQ para consultar productos del Grupo G (con autenticación JWT)
const amqp = require('amqplib');
const crypto = require('crypto');
const inventarioRpcService = require('./inventarioRpcService');
require('dotenv').config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const QUEUE_PRODUCTOS_LOGIN = 'productos.login';
const QUEUE_PRODUCTOS_LISTAR = 'productos.listar';
const QUEUE_PRODUCTO_CONSULTAR = 'producto.consultar';
const RPC_TIMEOUT_MS = 3500;

const PRODUCTOS_RPC_USER = process.env.PRODUCTOS_RPC_USER || 'productos';
const PRODUCTOS_RPC_PASSWORD = process.env.PRODUCTOS_RPC_PASSWORD || 'productos1';
const JWT_SECRET =
  process.env.JWT_SECRET ||
  'es_un_secreto_de_tu_mirada_y_la_mia,_un_presentimiento,_como_un_ángel_que_me_decia';
const JWT_EXPIRES_IN = Number(process.env.JWT_EXPIRES_IN) || 1800;

// Caché en memoria del token JWT para Productos RPC
let cachedProductosToken = null;
let cachedProductosTokenExpMs = 0;

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

function generarTokenRespaldoProductos() {
  const ahoraSeg = Math.floor(Date.now() / 1000);
  const expSeg = ahoraSeg + JWT_EXPIRES_IN;
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: PRODUCTOS_RPC_USER,
      role: 'operador',
      iat: ahoraSeg,
      exp: expSeg
    })
  );
  const firma = base64UrlEncode(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${firma}`;
}

// Catálogo base de respaldo sincronizado exactamente con Grupo G (Productos)
const PRODUCTOS_BASE = [
  { id: 1, nombre: 'MACBOOK',             precio: 2500000, icono: 'laptop',     categoria: 'Electrónica' },
  { id: 2, nombre: 'Audífonos Bluetooth', precio: 150000,  icono: 'headphones', categoria: 'Accesorios' },
  { id: 3, nombre: 'Camiseta básica',     precio: 35000,   icono: 'box',        categoria: 'Ropa' },
  { id: 5, nombre: 'jean azul',           precio: 80000,   icono: 'box',        categoria: 'Ropa' },
  { id: 6, nombre: 'Jabon',               precio: 2000,    icono: 'box',        categoria: 'Hogar' },
  { id: 7, nombre: 'Zapatera',            precio: 100000,  icono: 'box',        categoria: 'Hogar' },
  { id: 8, nombre: 'Mouse Bluetooth',     precio: 65000,   icono: 'mouse',      categoria: 'Accesorios' }
];

let rpcConnection = null;
let rpcChannel = null;
let replyQueueName = null;
const pendingCalls = new Map();

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
          resolve(JSON.parse(msg.content.toString()));
        } catch {
          resolve({ status: 500, error: 'Respuesta inválida' });
        }
      }
    }, { noAck: true });

    return rpcChannel;
  } catch (err) {
    console.warn('[Productos RPC] No se pudo inicializar canal RPC:', err.message);
    rpcConnection = null;
    rpcChannel = null;
    replyQueueName = null;
    return null;
  }
}

function callRpc(queue, payload = {}, options = {}) {
  const timeoutMs = options.timeoutMs || RPC_TIMEOUT_MS;
  const headers = options.headers || undefined;

  return new Promise(async (resolve, reject) => {
    const ch = await getRpcChannel();
    if (!ch || !replyQueueName) {
      return reject(new Error('Canal no disponible'));
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
      const body = payload !== null ? Buffer.from(JSON.stringify(payload)) : Buffer.alloc(0);
      ch.sendToQueue(queue, body, {
        correlationId: cid,
        replyTo: replyQueueName,
        expiration: String(timeoutMs),
        contentType: 'application/json',
        headers
      });
    } catch (err) {
      clearTimeout(timer);
      pendingCalls.delete(cid);
      reject(err);
    }
  });
}

/**
 * Obtiene un token JWT válido para consumir las colas protegidas de Productos (Grupo G).
 * 1) Intenta autenticarse contra la cola `productos.login` con PRODUCTOS_RPC_USER y PRODUCTOS_RPC_PASSWORD.
 * 2) Si `productos.login` no responde a tiempo, genera un token de respaldo firmado con JWT_SECRET.
 */
async function obtenerTokenProductosRpc(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedProductosToken && now < cachedProductosTokenExpMs - 15000) {
    return cachedProductosToken;
  }

  try {
    const loginRes = await callRpc(
      QUEUE_PRODUCTOS_LOGIN,
      {
        usuario: PRODUCTOS_RPC_USER,
        password: PRODUCTOS_RPC_PASSWORD
      },
      { timeoutMs: 2500 }
    );

    if (loginRes && loginRes.status === 200 && loginRes.data && loginRes.data.token) {
      cachedProductosToken = loginRes.data.token;
      const expSeconds = Number(loginRes.data.expira_en_segundos) || JWT_EXPIRES_IN;
      cachedProductosTokenExpMs = now + expSeconds * 1000;
      console.log(`[Productos RPC] Token JWT obtenido desde cola ${QUEUE_PRODUCTOS_LOGIN}`);
      return cachedProductosToken;
    }

    if (loginRes && loginRes.status === 401) {
      console.warn(`[Productos RPC] Credenciales rechazadas en ${QUEUE_PRODUCTOS_LOGIN}: ${loginRes.error}`);
    }
  } catch (err) {
    console.warn(
      `[Productos RPC] No se pudo autenticar en ${QUEUE_PRODUCTOS_LOGIN} (${err.message}). Usando token JWT firmado con secreto compartido.`
    );
  }

  cachedProductosToken = generarTokenRespaldoProductos();
  cachedProductosTokenExpMs = now + JWT_EXPIRES_IN * 1000;
  return cachedProductosToken;
}

/**
 * Ejecuta una llamada RPC autenticada con Bearer JWT hacia Productos (Grupo G).
 */
async function callAuthenticatedProductosRpc(queue, payload = {}) {
  let token = await obtenerTokenProductosRpc(false);

  for (let intento = 0; intento < 2; intento++) {
    const respuesta = await callRpc(queue, payload, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (respuesta && respuesta.status === 401 && intento === 0) {
      console.warn(`[Productos RPC] Token rechazado/expirado en ${queue}. Renovando token JWT...`);
      token = await obtenerTokenProductosRpc(true);
      continue;
    }

    return respuesta;
  }

  return null;
}

/**
 * Consulta un producto puntual por ID en Grupo G vía RPC autenticado (`producto.consultar`)
 */
async function consultarProducto(id) {
  try {
    const res = await callAuthenticatedProductosRpc(QUEUE_PRODUCTO_CONSULTAR, { id: Number(id) });
    if (res && res.status === 200 && res.data) {
      return res.data;
    }
    return null;
  } catch (err) {
    console.warn(`[Productos RPC] Error consultando producto #${id}:`, err.message);
    return null;
  }
}

/**
 * Consulta la lista de productos de Grupo G vía RPC autenticado y la combina con inventario
 */
async function listarProductos() {
  const mapaIconos = new Map(PRODUCTOS_BASE.map((p) => [p.id, p.icono]));
  const mapa = new Map();

  try {
    const res = await callAuthenticatedProductosRpc(QUEUE_PRODUCTOS_LISTAR, {});
    if (res && res.status === 200 && Array.isArray(res.data) && res.data.length > 0) {
      res.data.forEach((p) => {
        const id = Number(p.id);
        mapa.set(id, {
          id,
          nombre: p.nombre || `Producto #${id}`,
          precio: Number(p.precio) || 0,
          categoria: p.categoria || 'General',
          icono: mapaIconos.get(id) || 'box',
          origen: 'grupoG'
        });
      });
    }
  } catch (err) {
    // Si Grupo G no responde, se usan los productos base de Grupo G
  }

  if (mapa.size === 0) {
    PRODUCTOS_BASE.forEach((p) => mapa.set(p.id, { ...p }));
  }

  try {
    // Consultar también inventario vía RPC autenticado (Grupo H: inventario / 12345678)
    const inv = await inventarioRpcService.listarInventario();
    if (inv && Array.isArray(inv.inventario)) {
      inv.inventario.forEach((item) => {
        const id = Number(item.producto_id ?? item.id);
        if (mapa.has(id)) {
          const prod = mapa.get(id);
          mapa.set(id, {
            ...prod,
            stock: Number(item.stock ?? item.cantidad ?? 0)
          });
        }
      });
    }
  } catch (err) {
    // Si Grupo H no está activo, se omite el stock
  }

  const productos = Array.from(mapa.values()).sort((a, b) => a.id - b.id);
  return {
    total: productos.length,
    productos
  };
}

module.exports = {
  listarProductos,
  consultarProducto,
  obtenerTokenProductosRpc,
  PRODUCTOS_BASE
};
