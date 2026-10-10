// Servicio RPC sobre RabbitMQ para consultar productos del Grupo G
const amqp = require('amqplib');
const crypto = require('crypto');
require('dotenv').config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const QUEUE_PRODUCTOS_LISTAR = 'productos.listar';
const QUEUE_PRODUCTO_CONSULTAR = 'producto.consultar';
const RPC_TIMEOUT_MS = 3000;

// Catálogo base de respaldo sincronizado con Carro (Grupo D)
const PRODUCTOS_BASE = [
  { id: 1,  nombre: 'Portátil 14" Ryzen 5',       precio: 2500000, icono: 'laptop',     categoria: 'Electrónica' },
  { id: 2,  nombre: 'Mouse inalámbrico',          precio: 65000,   icono: 'mouse',      categoria: 'Accesorios' },
  { id: 3,  nombre: 'Teclado mecánico',           precio: 220000,  icono: 'keyboard',   categoria: 'Accesorios' },
  { id: 4,  nombre: 'Monitor 24" Full HD',        precio: 680000,  icono: 'monitor',    categoria: 'Electrónica' },
  { id: 5,  nombre: 'Audífonos Bluetooth',        precio: 150000,  icono: 'headphones', categoria: 'Accesorios' },
  { id: 6,  nombre: 'Disco SSD 1 TB',             precio: 310000,  icono: 'box',        categoria: 'Almacenamiento' },
  { id: 7,  nombre: 'Zapatera 6 niveles',         precio: 100000,  icono: 'box',        categoria: 'Hogar' },
  { id: 15, nombre: 'Portátil Gamer 15" Core i7', precio: 2500000, icono: 'laptop',     categoria: 'Electrónica' },
  { id: 10, nombre: 'Mouse Logitech Pro',         precio: 1200000, icono: 'mouse',      categoria: 'Accesorios' },
  { id: 12, nombre: 'Teclado mecánico RGB',       precio: 1200000, icono: 'keyboard',   categoria: 'Accesorios' },
  { id: 8,  nombre: 'Auriculares Bluetooth Pro',  precio: 350000,  icono: 'headphones', categoria: 'Accesorios' }
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

function callRpc(queue, payload = {}) {
  return new Promise(async (resolve, reject) => {
    const ch = await getRpcChannel();
    if (!ch || !replyQueueName) {
      return reject(new Error('Canal no disponible'));
    }

    const cid = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingCalls.delete(cid);
      reject(new Error('Timeout'));
    }, RPC_TIMEOUT_MS);

    pendingCalls.set(cid, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject
    });

    try {
      ch.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
        correlationId: cid,
        replyTo: replyQueueName,
        expiration: String(RPC_TIMEOUT_MS)
      });
    } catch (err) {
      clearTimeout(timer);
      pendingCalls.delete(cid);
      reject(err);
    }
  });
}

/**
 * Consulta la lista de productos de Grupo G vía RPC y la combina con la base de Carro
 */
async function listarProductos() {
  const mapa = new Map();
  PRODUCTOS_BASE.forEach((p) => mapa.set(p.id, p));

  try {
    const res = await callRpc(QUEUE_PRODUCTOS_LISTAR, {});
    if (res && res.status === 200 && Array.isArray(res.data)) {
      res.data.forEach((p) => {
        const id = Number(p.id);
        const existente = mapa.get(id) || {};
        mapa.set(id, {
          id,
          nombre: p.nombre || existente.nombre || `Producto #${id}`,
          precio: Number(p.precio) || existente.precio || 0,
          categoria: p.categoria || existente.categoria || 'General',
          icono: existente.icono || 'box',
          origen: 'grupoG'
        });
      });
    }
  } catch (err) {
    // Si Grupo G no responde, se usan los productos base
  }

  const productos = Array.from(mapa.values()).sort((a, b) => a.id - b.id);
  return {
    total: productos.length,
    productos
  };
}

module.exports = {
  listarProductos,
  PRODUCTOS_BASE
};
