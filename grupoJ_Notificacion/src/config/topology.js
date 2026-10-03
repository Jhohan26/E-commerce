import { eventTypes } from '../models/event.js';
export async function assertTopology(channel, config) {
  const dlx = `${config.queue}.errores.exchange`;
  const dlq = `${config.queue}.errores`;
  await channel.assertExchange(config.exchange, config.exchangeType, { durable: true });
  await channel.assertExchange(dlx, 'direct', { durable: true });
  await channel.assertQueue(dlq, { durable: true });
  await channel.bindQueue(dlq, dlx, 'error');
  await channel.assertQueue(config.queue, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': dlx, 'x-dead-letter-routing-key': 'error' }
  });
  for (const key of config.bindings?.length ? config.bindings : eventTypes) await channel.bindQueue(config.queue, config.exchange, key);
}
