/**
 * SIMULADOR DE PRUEBAS DE INTEGRACIÓN: MICROSERVICIO DE PAGOS (GRUPO B)
 * 
 * Este script simula cómo actúa el módulo de Pagos en PHP:
 * 1. Se conecta a CloudAMQP.
 * 2. Declara su cola oficial 'pagos.pedido_creado' y la enlaza a 'pedidos_exchange'.
 * 3. Escucha eventos 'PedidoCreado' emitidos por nuestro módulo de Pedidos.
 * 4. Valida el contrato tal como lo hace Order.php del Grupo B.
 * 5. Simula la aprobación y emite el evento 'PagoAprobado'.
 * 6. Confirma el mensaje con ACK.
 * 
 * Uso:
 *   npm run test-pagos
 *   (o: node scripts/test_pagos_simulator.js)
 */
require('dotenv').config();
const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const PEDIDOS_EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'pedidos_exchange';
const PAGOS_QUEUE = 'pagos.pedido_creado'; // Cola oficial configurada por Grupo B
const PAGOS_EXCHANGE = 'pagos_exchange';   // Exchange donde Pagos emite sus resultados

const money = (n) => `$ ${Number(n).toLocaleString('es-CO')}`;

async function runPagosSimulator() {
  console.log('================================================================');
  console.log('    SIMULADOR DE INTEGRACIÓN: MICROSERVICIO DE PAGOS (GRUPO B)  ');
  console.log('================================================================');
  console.log(`Conectando a RabbitMQ: ${RABBITMQ_URL.replace(/:\/\/[^@]*@/, '://***:***@')}...\n`);

  try {
    const conn = await amqp.connect(RABBITMQ_URL);
    const channel = await conn.createChannel();

    // 1. Asegurar exchange de Pedidos (fanout, durable)
    await channel.assertExchange(PEDIDOS_EXCHANGE, 'fanout', { durable: true });

    // 2. Asegurar cola propia de Pagos y enlazarla
    await channel.assertQueue(PAGOS_QUEUE, { durable: true });
    await channel.bindQueue(PAGOS_QUEUE, PEDIDOS_EXCHANGE, '');

    // 3. Preparar exchange para publicar los eventos de pago
    await channel.assertExchange(PAGOS_EXCHANGE, 'topic', { durable: true });

    // Procesar de a 1 mensaje a la vez
    await channel.prefetch(1);

    console.log(`[OK] Exchange de Pedidos vinculado: "${PEDIDOS_EXCHANGE}"`);
    console.log(`[OK] Cola activa de Pagos:         "${PAGOS_QUEUE}"`);
    console.log(`[OK] Exchange de salida de Pagos:   "${PAGOS_EXCHANGE}"`);
    console.log('\n================================================================');
    console.log('Esperando eventos "PedidoCreado"...');
    console.log('Crea un pedido desde http://localhost:3000 o vía POST /api/pedidos.');
    console.log('Presiona Ctrl + C para detener.\n================================================================\n');

    channel.consume(PAGOS_QUEUE, async (msg) => {
      if (!msg) return;

      try {
        const rawContent = msg.content.toString();
        const data = JSON.parse(rawContent);

        console.log(`\n------------------------------------------------------------`);
        console.log(`[EVENTO RECIBIDO EN PAGOS]`);
        console.log(`Evento:   ${data.evento || 'Sin definir'}`);
        console.log(`Pedido:   #${data.pedidoId}`);
        console.log(`Cliente:  #${data.clienteId}`);
        console.log(`Fecha:    ${data.fecha}`);
        console.log(`Total:    ${money(data.total)}`);

        // Validación de contrato (idéntica a Order.php del Grupo B)
        if (data.evento !== 'PedidoCreado') {
          throw new Error(`Evento no reconocido. Se esperaba "PedidoCreado", se recibió "${data.evento}"`);
        }
        if (!data.pedidoId || !Number.isInteger(Number(data.pedidoId))) {
          throw new Error('pedidoId debe ser un entero positivo compatible con INT');
        }
        if (!data.clienteId || !Number.isInteger(Number(data.clienteId))) {
          throw new Error('clienteId debe ser un entero positivo compatible con INT');
        }
        if (!data.total || Number(data.total) <= 0) {
          throw new Error('total debe ser un número decimal mayor a cero');
        }

        console.log(`\n>>> VALIDACIÓN DE CONTRATO EXITOSA (Cumple con Order.php) <<<`);

        // Simular procesamiento del cobro
        const pagoId = Math.floor(1000 + Math.random() * 9000);
        const pagoEvent = {
          evento: 'PagoAprobado',
          pedidoId: Number(data.pedidoId),
          clienteId: Number(data.clienteId),
          pagoId,
          total: Number(data.total),
          estado: 'APROBADO',
          fecha: new Date().toISOString()
        };

        // Publicar PagoAprobado
        channel.publish(
          PAGOS_EXCHANGE,
          'pago.aprobado',
          Buffer.from(JSON.stringify(pagoEvent, null, 2)),
          {
            persistent: true,
            contentType: 'application/json',
            type: 'PagoAprobado'
          }
        );

        console.log(`[PAGO APROBADO] Pago #${pagoId} generado para Pedido #${data.pedidoId}`);
        console.log(`[RABBITMQ] Evento "PagoAprobado" publicado en "${PAGOS_EXCHANGE}" (routing key: pago.aprobado)`);
        console.log(`------------------------------------------------------------`);

        // Confirmar recepción del mensaje a RabbitMQ
        channel.ack(msg);
      } catch (err) {
        console.error(`[ERROR EN PAGOS] No se pudo procesar el pedido: ${err.message}`);
        // Descartar mensaje mal formado para no bloquear la cola
        channel.reject(msg, false);
      }
    });

  } catch (error) {
    console.error(`[ERROR DE CONEXIÓN] ${error.message}`);
    process.exit(1);
  }
}

runPagosSimulator();
