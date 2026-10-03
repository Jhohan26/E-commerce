import { loadConfig } from './config/config.js';
import { logger } from './config/logger.js';
import { NotificationRepository } from './repositories/notificationRepository.js';
import { NotificationService } from './services/notificationService.js';
import { RabbitConsumer } from './consumers/rabbitConsumer.js';
import { createApp } from './app.js';
const config = loadConfig();
const repository = new NotificationRepository(config.databasePath);
const consumer = new RabbitConsumer(config, new NotificationService(repository), logger);
const server = createApp(repository, () => consumer.connected, logger).listen(config.port, () => logger.info('api_iniciada', { puerto: config.port }));
consumer.start();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10000).unref();
  await consumer.stop();
  server.close(() => { repository.close(); clearTimeout(timeout); logger.info('servicio_detenido'); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
