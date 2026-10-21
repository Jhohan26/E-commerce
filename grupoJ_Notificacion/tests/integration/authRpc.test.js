import test from 'node:test';
import assert from 'node:assert/strict';
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { NotificationRepository } from '../../src/repositories/notificationRepository.js';
import { AccessService } from '../../src/services/accessService.js';
import { startAuthRpc } from '../../src/consumers/authRpc.js';
import { NotificacionesRpc } from '../../examples/notificaciones-rpc.js';
import { NotificationService } from '../../src/services/notificationService.js';

test('Login RPC real en cola aislada emite token y reutiliza sesión', { timeout: 30000 }, async () => {
  const url = process.env.RABBITMQ_URL;
  assert.ok(url, 'Configura RABBITMQ_URL');
  const connection = await amqp.connect(url, { timeout: 5000, rejectUnauthorized: true });
  connection.on('error', () => {});
  const repo = new NotificationRepository(':memory:');
  const queue = `test.j.auth.${randomUUID()}`;
  try {
    const access = new AccessService(repo.db, { secret: 'z'.repeat(48) });
    await access.provision('pagos', 'isolated-test-password-long', 'module', ['PagoAprobado']);
    const eventQueue = `${queue}.eventos`;
    const channel = await startAuthRpc(connection, { authRpcQueue: queue, eventRpcQueue: eventQueue, access }, new NotificationService(repo));
    const client = new NotificacionesRpc({ url, queue, eventQueue, username: 'pagos', password: 'isolated-test-password-long' });
    const token = await client.token();
    assert.equal(access.authenticate(token, { event: 'PagoAprobado' }).username, 'pagos');
    assert.equal(await client.token(), token);
    assert.throws(() => access.authenticate(token, { admin: true }), e => e.status === 403);
    const event = { evento: 'PagoAprobado', pedidoId: 1, clienteId: 1, fecha: new Date().toISOString() };
    assert.equal((await client.send(event)).duplicate, false);
    assert.equal((await client.send(event)).duplicate, true);
    const bad = new NotificacionesRpc({ url, queue, username: 'pagos', password: 'incorrect-password' });
    await assert.rejects(() => bad.token(), /401/);
    await channel.cancel(channel.authConsumerTag);
    await channel.cancel(channel.eventConsumerTag);
    await channel.deleteQueue(eventQueue);
    await channel.deleteQueue(queue);
  } finally {
    await connection.close().catch(() => {});
    repo.close();
  }
});
