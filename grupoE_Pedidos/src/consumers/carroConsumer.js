// Consumidor RabbitMQ para solicitudes de pedidos provenientes del Carrito de Compras (Grupo D)
const amqp = require('amqplib');
const service = require('../services/pedidosService');
require('dotenv').config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const QUEUE_CARRO = 'pedidos.desde_carro';

let connection = null;
let channel = null;
let isConsuming = false;

async function iniciarConsumidorCarro() {
  if (isConsuming) return;

  try {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    // Asegurar cola durable para recibir pedidos de Carro
    await channel.assertQueue(QUEUE_CARRO, { durable: true });
    await channel.prefetch(1);

    console.log(`[Consumidor Carro] Escuchando solicitudes en la cola "${QUEUE_CARRO}"...`);
    isConsuming = true;

    channel.consume(QUEUE_CARRO, async (msg) => {
      if (!msg) return;

      const replyTo = msg.properties.replyTo;
      const correlationId = msg.properties.correlationId;

      try {
        const body = JSON.parse(msg.content.toString());
        console.log(`\n[Carro -> Pedidos] Solicitud recibida para Cliente #${body.clienteId}:`);

        // 1. Crear el pedido en MySQL y emitir evento oficial PedidoCreado a pedidos_exchange
        const resultado = await service.crearPedido({
          clienteId: body.clienteId,
          productos: body.productos
        });

        const pedido = resultado.pedido;
        console.log(`[Carro -> Pedidos] Pedido #${pedido.id} registrado exitosamente en MySQL.`);

        // 2. Si Carro solicitó respuesta por RPC (replyTo), responder con el evento oficial
        if (replyTo && correlationId) {
          const respuesta = {
            status: 201,
            mensaje: 'Pedido creado exitosamente',
            data: {
              evento: 'PedidoCreado',
              pedidoId: pedido.id,
              clienteId: pedido.clienteId,
              fecha: pedido.fecha,
              total: pedido.total,
              productos: pedido.productos
            }
          };

          channel.sendToQueue(
            replyTo,
            Buffer.from(JSON.stringify(respuesta)),
            {
              correlationId,
              contentType: 'application/json'
            }
          );
        }

        // 3. Confirmar procesamiento a RabbitMQ
        channel.ack(msg);
      } catch (err) {
        console.error(`[Carro -> Pedidos] Error procesando solicitud:`, err.message);

        // Si es RPC, devolver error a Carro
        if (replyTo && correlationId) {
          const respuestaError = {
            status: 400,
            error: err.message
          };
          try {
            channel.sendToQueue(
              replyTo,
              Buffer.from(JSON.stringify(respuestaError)),
              {
                correlationId,
                contentType: 'application/json'
              }
            );
          } catch {}
        }

        // Descartar mensaje fallido para no bloquear la cola
        channel.reject(msg, false);
      }
    });

    connection.on('close', () => {
      isConsuming = false;
      channel = null;
      connection = null;
    });

    connection.on('error', (err) => {
      console.warn(`[Consumidor Carro] Error de conexión: ${err.message}`);
    });

  } catch (err) {
    console.warn(`[Consumidor Carro] No se pudo iniciar: ${err.message}`);
    isConsuming = false;
  }
}

async function detenerConsumidorCarro() {
  isConsuming = false;
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
  } catch {}
}

// Si se ejecuta directamente con node src/consumers/carroConsumer.js
if (require.main === module) {
  iniciarConsumidorCarro();
  process.on('SIGINT', async () => {
    await detenerConsumidorCarro();
    process.exit(0);
  });
}

module.exports = {
  iniciarConsumidorCarro,
  detenerConsumidorCarro
};
