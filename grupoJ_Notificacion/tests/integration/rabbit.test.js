import test from 'node:test';
import assert from 'node:assert/strict';
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../../src/config/config.js';
import { assertTopology } from '../../src/config/topology.js';
import { NotificationRepository } from '../../src/repositories/notificationRepository.js';
import { NotificationService } from '../../src/services/notificationService.js';
import { RabbitConsumer } from '../../src/consumers/rabbitConsumer.js';
import { createApp } from '../../src/app.js';
import { eventTypes } from '../../src/models/event.js';
import { JSDOM } from 'jsdom';
const log = { info() {}, error() {} };
async function until(predicate) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Tiempo de espera agotado');
}
test('RabbitMQ real → consumidor → SQLite → HTTP, DLQ y recuperación', { timeout: 60000 }, async () => {
  const suffix = randomUUID();
  const config = { ...loadConfig(), sources: undefined, exchange: `test.j.${suffix}`, queue: `test.j.${suffix}`, bindings: eventTypes, reconnectMs: 200 };
  const repo = new NotificationRepository(':memory:');
  const service = new NotificationService(repo);
  const processEvent = service.process.bind(service);
  let failNext = false;
  service.process = payload => {
    if (failNext) { failNext = false; throw new Error('Fallo temporal de almacenamiento simulado'); }
    return processEvent(payload);
  };
  const consumer = new RabbitConsumer(config, service, log);
  let connection, channel, server;
  try {
    connection = await amqp.connect(config.rabbitUrl, { timeout: 5000 });
    channel = await connection.createConfirmChannel();
    await assertTopology(channel, config);
    for (const type of eventTypes) {
      const payload = readFileSync(new URL(`../../examples/${type}.json`, import.meta.url));
      channel.publish(config.exchange, type, payload, { persistent: true });
    }
    await channel.waitForConfirms();
    assert.equal((await channel.checkQueue(config.queue)).messageCount, 5);
    consumer.start();
    await until(() => repo.list().length === 5);
    server = createApp(repo, () => consumer.connected, log).listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/notificaciones/cliente/25`);
    assert.equal((await response.json()).length, 5);
    const base = `http://127.0.0.1:${server.address().port}`;
    const dom = new JSDOM(readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8'), { url: base, runScripts: 'outside-only' });
    try {
      dom.window.fetch = (path, options) => fetch(new URL(path, base), options);
      dom.window.eval(readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8'));
      await until(() => dom.window.document.querySelectorAll('.notification').length === 5);
      dom.window.document.querySelector('.mark-read').click();
      await until(() => repo.list().filter(row => row.leida).length === 1);
      await until(() => dom.window.document.querySelector('#read').textContent === '1');
    } finally { dom.window.close(); }
    channel.publish(config.exchange, 'PedidoCreado', Buffer.from('{'), { persistent: true });
    await channel.waitForConfirms();
    await until(async () => (await channel.checkQueue(`${config.queue}.errores`)).messageCount === 1);
    await consumer.stop();
    const extra = { evento: 'PagoAprobado', pedidoId: 9876, clienteId: 25, fecha: '2026-10-01T10:40:00' };
    channel.publish(config.exchange, extra.evento, Buffer.from(JSON.stringify(extra)), { persistent: true });
    await channel.waitForConfirms();
    assert.equal((await channel.checkQueue(config.queue)).messageCount, 1);
    consumer.stopped = false; consumer.start();
    await until(() => repo.list().length === 6);
    channel.publish(config.exchange, extra.evento, Buffer.from(JSON.stringify(extra)), { persistent: true });
    await channel.waitForConfirms();
    await until(async () => (await channel.checkQueue(config.queue)).messageCount === 0);
    assert.equal(repo.list().length, 6);
    failNext = true;
    const recovered = { ...extra, pedidoId: 9877 };
    channel.publish(config.exchange, recovered.evento, Buffer.from(JSON.stringify(recovered)), { persistent: true });
    await channel.waitForConfirms();
    await until(() => repo.list().length === 7);
    assert.equal(failNext, false);
  } finally {
    await consumer.stop();
    if (server) await new Promise(r => server.close(r));
    if (channel) {
      await channel.deleteQueue(config.queue);
      await channel.deleteQueue(`${config.queue}.errores`);
      await channel.deleteExchange(config.exchange);
      await channel.deleteExchange(`${config.queue}.errores.exchange`);
      await channel.close();
    }
    if (connection) await connection.close();
    repo.close();
  }
});
