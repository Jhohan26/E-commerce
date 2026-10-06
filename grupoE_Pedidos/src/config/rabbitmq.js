// Conexión a RabbitMQ y configuración de topología (Exchange Fanout y cola de auditoría)
const amqp = require('amqplib');
require('dotenv').config();

const config = {
  url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  exchange: process.env.RABBITMQ_EXCHANGE || 'pedidos_exchange',
  exchangeType: process.env.RABBITMQ_EXCHANGE_TYPE || 'fanout',
  routingKey: process.env.RABBITMQ_ROUTING_KEY || 'pedido.creado',
  auditQueue: process.env.RABBITMQ_AUDIT_QUEUE || 'pedidos_creados_auditoria'
};

const RECONNECT_DELAY_MS = 5000;
const AUDIT_QUEUE_TTL_MS = 24 * 60 * 60 * 1000;

let connection = null;
let channel = null;
let connecting = null;
let reconnectTimer = null;
let closing = false;

const maskUrl = (url) => url.replace(/:\/\/[^@]*@/, '://***:***@');

function scheduleReconnect() {
  if (closing || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectRabbitMQ();
  }, RECONNECT_DELAY_MS);
}

/**
 * Abre la conexión y declara la topología. Si ya hay una conexión en curso, la reutiliza.
 */
function connectRabbitMQ() {
  if (channel) return Promise.resolve({ connected: true });
  if (connecting) return connecting;

  connecting = (async () => {
    let conn = null;
    try {
      console.log(`[RabbitMQ] Conectando a ${maskUrl(config.url)}...`);
      conn = await amqp.connect(config.url);

      conn.on('error', (err) => console.error('[RabbitMQ] Error de conexión:', err.message));
      conn.on('close', () => {
        if (connection === conn) {
          connection = null;
          channel = null;
        }
        if (!closing) {
          console.warn(`[RabbitMQ] Conexión cerrada. Reintentando en ${RECONNECT_DELAY_MS / 1000} s...`);
          scheduleReconnect();
        }
      });

      // Canal con confirmaciones: RabbitMQ avisa cuando realmente recibió cada mensaje.
      const ch = await conn.createConfirmChannel();
      ch.on('error', (err) => console.error('[RabbitMQ] Error de canal:', err.message));
      ch.on('close', () => {
        if (channel === ch) channel = null;
      });

      await ch.assertExchange(config.exchange, config.exchangeType, { durable: true });

      if (config.auditQueue) {
        await ch.assertQueue(config.auditQueue, {
          durable: true,
          arguments: { 'x-message-ttl': AUDIT_QUEUE_TTL_MS, 'x-max-length': 1000 }
        });
        await ch.bindQueue(config.auditQueue, config.exchange, config.routingKey);
      }

      connection = conn;
      channel = ch;

      console.log(`[RabbitMQ] Conectado. Exchange "${config.exchange}" (${config.exchangeType}).`);
      if (config.auditQueue) console.log(`[RabbitMQ] Cola de auditoría: "${config.auditQueue}".`);
      return { connected: true };
    } catch (error) {
      console.error(`[RabbitMQ] No se pudo conectar: ${error.message}`);
      if (conn) conn.close().catch(() => {});
      scheduleReconnect();
      return { connected: false, message: error.message };
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

/**
 * Devuelve el canal activo; intenta conectar si no existe.
 */
async function getChannel() {
  if (!channel) {
    const result = await connectRabbitMQ();
    if (!result.connected || !channel) {
      throw new Error(
        'No hay conexión activa con RabbitMQ. Verifica RABBITMQ_URL en el archivo .env o que el servicio esté corriendo.'
      );
    }
  }
  return channel;
}

function getRabbitStatus() {
  return {
    connected: !!channel,
    exchange: config.exchange,
    exchangeType: config.exchangeType,
    queue: config.auditQueue,
    url: maskUrl(config.url)
  };
}

async function closeRabbitMQ() {
  closing = true;
  clearTimeout(reconnectTimer);
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
  } catch {
    // Ya estaba cerrado.
  } finally {
    channel = null;
    connection = null;
  }
}

module.exports = { config, connectRabbitMQ, getChannel, getRabbitStatus, closeRabbitMQ };
