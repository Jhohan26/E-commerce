import { eventTypes } from '../models/event.js';
export async function assertTopology(channel, config) {
  const dlx = `${config.queue}.errores.exchange`;
  const dlq = `${config.queue}.errores`;
  await channel.assertExchange(dlx, 'direct', { durable: true });
  await channel.assertQueue(dlq, { durable: true });
  await channel.bindQueue(dlq, dlx, 'error');
  await channel.assertQueue(config.queue, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': dlx, 'x-dead-letter-routing-key': 'error' }
  });
  const sources = config.sources || [{ exchange: config.exchange, type: config.exchangeType,
    keys: config.bindings?.length ? config.bindings : eventTypes }];
  for (const source of sources) {
    await channel.assertExchange(source.exchange, source.type, { durable: true });
    for (const key of new Set(source.keys)) await channel.bindQueue(config.queue, source.exchange, key);
  }
}
