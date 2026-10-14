// Consumidor RabbitMQ para eventos de inventario provenientes del Microservicio de Inventario (Grupo H)
const amqp = require('amqplib');
const service = require('../services/pedidosService');
require('dotenv').config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE_INVENTARIO = process.env.RABBITMQ_EXCHANGE_INVENTARIO || 'inventario_exchange';
const QUEUE_INVENTARIO = 'pedidos.resultado_inventario';

let connection = null;
let channel = null;
let isConsuming = false;

async function iniciarConsumidorInventario() {
  if (isConsuming) return;

  try {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    // 1. Declarar/asegurar exchange de salida de Inventario (fanout, durable)
    await channel.assertExchange(EXCHANGE_INVENTARIO, 'fanout', { durable: true });

    // 2. Declarar cola propia durable para que Pedidos reciba los resultados
    await channel.assertQueue(QUEUE_INVENTARIO, { durable: true });

    // 3. Enlazar cola a inventario_exchange
    await channel.bindQueue(QUEUE_INVENTARIO, EXCHANGE_INVENTARIO, '');

    await channel.prefetch(1);

    console.log(`[Consumidor Inventario] Escuchando resultados en la cola "${QUEUE_INVENTARIO}" (exchange: ${EXCHANGE_INVENTARIO})...`);
    isConsuming = true;

    channel.consume(QUEUE_INVENTARIO, async (msg) => {
      if (!msg) return;

      try {
        const body = JSON.parse(msg.content.toString());
        const pedidoId = Number(body.pedidoId);
        const evento = body.evento;

        if (!pedidoId) {
          channel.ack(msg);
          return;
        }

        console.log(`\n[Inventario -> Pedidos] Evento "${evento || 'Desconocido'}" recibido para Pedido #${pedidoId}:`);

        if (evento === 'InventarioInsuficiente') {
          // Si no hay existencias en bodega, cancelar el pedido automáticamente
          await service.cambiarEstado(pedidoId, 'CANCELADO');
          console.log(`[Inventario -> Pedidos] Pedido #${pedidoId} actualizado a estado "CANCELADO" por falta de stock.`);
        } else if (evento === 'InventarioActualizado') {
          console.log(`[Inventario -> Pedidos] Stock reservado exitosamente para Pedido #${pedidoId}.`);
        }

        channel.ack(msg);
      } catch (err) {
        console.error('[Inventario -> Pedidos] Error procesando evento de inventario:', err.message);
        channel.reject(msg, false);
      }
    });

    connection.on('close', () => {
      isConsuming = false;
      channel = null;
      connection = null;
    });

    connection.on('error', (err) => {
      console.warn(`[Consumidor Inventario] Error de conexión: ${err.message}`);
    });

  } catch (err) {
    console.warn(`[Consumidor Inventario] No se pudo iniciar: ${err.message}`);
    isConsuming = false;
  }
}

async function detenerConsumidorInventario() {
  isConsuming = false;
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
  } catch {}
}

if (require.main === module) {
  iniciarConsumidorInventario();
  process.on('SIGINT', async () => {
    await detenerConsumidorInventario();
    process.exit(0);
  });
}

module.exports = {
  iniciarConsumidorInventario,
  detenerConsumidorInventario
};
