// Consumidor RabbitMQ para eventos de pagos provenientes del Microservicio de Pagos (Grupo B)
const amqp = require('amqplib');
const service = require('../services/pedidosService');
require('dotenv').config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE_PAGOS = process.env.RABBITMQ_EXCHANGE_PAGOS || 'pagos_exchange';
const QUEUE_PAGOS = 'pedidos.resultado_pagos';

let connection = null;
let channel = null;
let isConsuming = false;

async function iniciarConsumidorPagos() {
  if (isConsuming) return;

  try {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    // 1. Declarar/asegurar exchange de salida de Pagos (topic, durable)
    await channel.assertExchange(EXCHANGE_PAGOS, 'topic', { durable: true });

    // 2. Declarar cola propia durable para que Pedidos reciba los resultados
    await channel.assertQueue(QUEUE_PAGOS, { durable: true });

    // 3. Enlazar cola a pagos_exchange escuchando los eventos de pagos (aprobado y rechazado)
    await channel.bindQueue(QUEUE_PAGOS, EXCHANGE_PAGOS, 'pago.*');
    await channel.bindQueue(QUEUE_PAGOS, EXCHANGE_PAGOS, '#');

    await channel.prefetch(1);

    console.log(`[Consumidor Pagos] Escuchando resultados en la cola "${QUEUE_PAGOS}" (exchange: ${EXCHANGE_PAGOS})...`);
    isConsuming = true;

    channel.consume(QUEUE_PAGOS, async (msg) => {
      if (!msg) return;

      try {
        const body = JSON.parse(msg.content.toString());
        const pedidoId = Number(body.pedidoId);
        const evento = body.evento || (body.estado === 'APROBADO' ? 'PagoAprobado' : (body.estado === 'RECHAZADO' ? 'PagoRechazado' : null));

        if (!pedidoId) {
          channel.ack(msg);
          return;
        }

        console.log(`\n[Pagos -> Pedidos] Evento "${evento || 'Desconocido'}" recibido para Pedido #${pedidoId}:`);

        if (evento === 'PagoAprobado' || body.estado === 'APROBADO') {
          await service.cambiarEstado(pedidoId, 'PAGADO');
          console.log(`[Pagos -> Pedidos] Pedido #${pedidoId} actualizado a estado "PAGADO" exitosamente.`);
        } else if (evento === 'PagoRechazado' || body.estado === 'RECHAZADO') {
          const motivo = body.motivo
            ? `Pago rechazado: ${body.motivo}`
            : 'Pago rechazado (Grupo B)';
          await service.cambiarEstado(pedidoId, 'CANCELADO', motivo);
          console.log(`[Pagos -> Pedidos] Pedido #${pedidoId} actualizado a estado "CANCELADO" (${motivo}).`);
        } else {
          console.log(`[Pagos -> Pedidos] Evento "${evento}" recibido sin acción requerida.`);
        }

        channel.ack(msg);
      } catch (err) {
        console.error('[Pagos -> Pedidos] Error procesando evento de pago:', err.message);
        // Si el pedido no existe o datos inválidos, descartar el mensaje para no bloquear la cola
        channel.reject(msg, false);
      }
    });

    connection.on('close', () => {
      isConsuming = false;
      channel = null;
      connection = null;
      setTimeout(iniciarConsumidorPagos, 5000);
    });

    connection.on('error', (err) => {
      console.warn(`[Consumidor Pagos] Error de conexión: ${err.message}`);
    });

  } catch (err) {
    console.warn(`[Consumidor Pagos] No se pudo iniciar: ${err.message}. Reintentando en 5s...`);
    isConsuming = false;
    setTimeout(iniciarConsumidorPagos, 5000);
  }
}

async function detenerConsumidorPagos() {
  isConsuming = false;
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
  } catch {}
}

if (require.main === module) {
  iniciarConsumidorPagos();
  process.on('SIGINT', async () => {
    await detenerConsumidorPagos();
    process.exit(0);
  });
}

module.exports = {
  iniciarConsumidorPagos,
  detenerConsumidorPagos
};
