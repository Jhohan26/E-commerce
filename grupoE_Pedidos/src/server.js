/**
 * Punto de entrada: levanta el servidor HTTP y conecta MySQL y RabbitMQ.
 * Uso: npm start
 */
require('dotenv').config();

const app = require('./app');
const { pool, checkDbConnection } = require('./config/db');
const { config: rabbit, connectRabbitMQ, closeRabbitMQ } = require('./config/rabbitmq');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, async () => {
  console.log('================================================================');
  console.log('MICROSERVICIO DE PEDIDOS INICIADO');
  console.log(`Servidor web disponible en: http://localhost:${PORT}`);
  console.log('================================================================');

  const db = await checkDbConnection();
  console.log(db.connected ? `[MySQL] OK: ${db.message}` : `[MySQL] ADVERTENCIA: ${db.message}`);

  const mq = await connectRabbitMQ();
  if (mq.connected) {
    console.log(`[RabbitMQ] OK: productor conectado (exchange: ${rabbit.exchange})`);
  } else {
    console.warn(`[RabbitMQ] ADVERTENCIA: ${mq.message}`);
    console.warn('[RabbitMQ] Revisa RABBITMQ_URL en el archivo .env. Se reintentará cada 5 segundos.');
  }
  console.log('================================================================\n');
});

server.on('error', (err) => {
  console.error(`No se pudo iniciar el servidor en el puerto ${PORT}: ${err.message}`);
  process.exit(1);
});

// Cierre ordenado con Ctrl + C
async function shutdown(signal) {
  console.log(`\n${signal} recibido. Cerrando servicios...`);
  server.close();
  await closeRabbitMQ();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
