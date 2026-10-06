// Publicador del evento PedidoCreado hacia RabbitMQ
const { config, getChannel } = require('../config/rabbitmq');

const CONFIRM_TIMEOUT_MS = 5000;

/**
 * Construye el JSON oficial del evento PedidoCreado.
 */
function buildPedidoCreado(pedido) {
  return {
    evento: 'PedidoCreado',
    pedidoId: Number(pedido.pedidoId),
    clienteId: Number(pedido.clienteId),
    fecha: pedido.fecha, // ISO sin zona horaria, ej. "2026-10-01T10:30:00"
    total: Number(pedido.total),
    productos: pedido.productos.map((p) => ({
      productoId: Number(p.productoId),
      cantidad: Number(p.cantidad),
      precio: Number(p.precio)
    }))
  };
}

function publishWithConfirm(channel, body, options) {
  const confirmed = new Promise((resolve, reject) => {
    channel.publish(config.exchange, config.routingKey, body, options, (err) => {
      if (err) reject(new Error('RabbitMQ rechazó el mensaje.'));
      else resolve();
    });
  });

  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('RabbitMQ no confirmó el mensaje a tiempo.')), CONFIRM_TIMEOUT_MS).unref();
  });

  return Promise.race([confirmed, timeout]);
}

/**
 * Publica PedidoCreado en el exchange. Nunca lanza: devuelve { success, payload | error }.
 */
async function publicarPedidoCreado(pedido) {
  try {
    const channel = await getChannel();
    const payload = buildPedidoCreado(pedido);

    await publishWithConfirm(channel, Buffer.from(JSON.stringify(payload, null, 2)), {
      persistent: true, // RabbitMQ guarda el mensaje en disco
      contentType: 'application/json',
      type: 'PedidoCreado',
      timestamp: Math.floor(Date.now() / 1000)
    });

    console.log(`[RabbitMQ] PedidoCreado publicado en "${config.exchange}": pedido #${payload.pedidoId}`);
    return { success: true, payload };
  } catch (error) {
    console.error('[RabbitMQ] Error publicando PedidoCreado:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { buildPedidoCreado, publicarPedidoCreado };
