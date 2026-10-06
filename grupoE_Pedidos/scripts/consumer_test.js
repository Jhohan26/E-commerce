// Simulador de consumidor para probar la recepción del evento PedidoCreado (npm run test-consumer)
const amqp = require('amqplib');
require('dotenv').config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE_NAME = process.env.RABBITMQ_EXCHANGE || 'pedidos_exchange';
const EXCHANGE_TYPE = process.env.RABBITMQ_EXCHANGE_TYPE || 'fanout';
const ROUTING_KEY = process.env.RABBITMQ_ROUTING_KEY || 'pedido.creado';
const QUEUE_NAME = process.env.RABBITMQ_CONSUMER_QUEUE || 'simulador_pedidos_queue';

const money = (n) => `$${Number(n).toLocaleString('es-CO')}`;

async function startConsumer() {
  console.log('===========================================================');
  console.log('SIMULADOR DE CONSUMIDOR DE PEDIDOS (RABBITMQ)');
  console.log('===========================================================');
  console.log(`Conectando a RabbitMQ: ${RABBITMQ_URL.replace(/:\/\/[^@]*@/, '://***:***@')}...`);

  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    // Mismos parámetros que el productor; si difieren, RabbitMQ rechaza la declaración.
    await channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);
    await channel.prefetch(1);

    console.log(`[OK] Exchange: "${EXCHANGE_NAME}"  |  Cola propia: "${QUEUE_NAME}"`);
    console.log('Esperando eventos de pedidos... (Ctrl + C para salir)\n');

    channel.consume(QUEUE_NAME, (msg) => {
      if (msg === null) return;

      try {
        // Pasos 4 a 6 de la Fase 5: recibir el JSON, convertirlo a objeto y procesarlo.
        const data = JSON.parse(msg.content.toString());

        console.log('-----------------------------------------------------------');
        console.log(`[EVENTO RECIBIDO] ${data.evento || 'Desconocido'}`);
        console.log(`Pedido:   #${data.pedidoId}`);
        console.log(`Cliente:  #${data.clienteId}`);
        console.log(`Fecha:    ${data.fecha}`);
        console.log(`Total:    ${money(data.total)}`);
        console.log(`Productos (${Array.isArray(data.productos) ? data.productos.length : 0}):`);
        (data.productos || []).forEach((p, i) => {
          console.log(`  ${i + 1}. Producto #${p.productoId}  x${p.cantidad}  a ${money(p.precio)}`);
        });
        console.log('-----------------------------------------------------------');

        // Paso 8 de la Fase 5: confirmar el procesamiento (ACK).
        channel.ack(msg);
        console.log('[ACK] Mensaje confirmado a RabbitMQ.\n');
      } catch (error) {
        console.error('Error al procesar el mensaje:', error.message);
        channel.nack(msg, false, false); // mensaje inválido: no reintentar
      }
    });

    const salir = async () => {
      await channel.close().catch(() => {});
      await connection.close().catch(() => {});
      process.exit(0);
    };
    process.on('SIGINT', salir);
    process.on('SIGTERM', salir);
  } catch (error) {
    console.error('Error al iniciar el consumidor:', error.message);
    process.exit(1);
  }
}

startConsumer();
