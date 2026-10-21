import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificacionesRpc } from '../examples/notificaciones-rpc.js';
import { AccessService } from '../src/services/accessService.js';
import { NotificationRepository } from '../src/repositories/notificationRepository.js';
import { NotificationService } from '../src/services/notificationService.js';
import { handleAuthRequest, handleEventRequest } from '../src/consumers/authRpc.js';

test('Worker renueva el JWT a los 30 minutos y una sola vez tras 401, con formato Clientes', async () => {
  const repo = new NotificationRepository(':memory:');
  let now = Date.now(), logins = 0, forced = false;
  const access = new AccessService(repo.db, { secret: 'z'.repeat(48) }, () => now);
  try {
    await access.provision('pagos', 'test-password-worker-long', 'module', ['PagoAprobado']);
    const service = new NotificationService(repo);
    const client = new NotificacionesRpc({ username: 'pagos', password: 'test-password-worker-long', clock: () => now,
      async transport(queue, payload, token) {
        const message = { content: Buffer.from(JSON.stringify(payload)), properties: { headers: { Authorization: `Bearer ${token}` } } };
        if (queue === 'notificaciones.auth.login') { logins++; return handleAuthRequest(message, access); }
        if (forced) { forced = false; return { status: 401 }; }
        return handleEventRequest(message, access, service);
      } });
    const event = { evento: 'PagoAprobado', pedidoId: 1, clienteId: 1, fecha: new Date(now).toISOString() };
    const first = await client.send(event);
    assert.equal(first.duplicate, false);
    assert.equal((await client.send(event)).duplicate, true);
    assert.equal(logins, 1);
    now += 1800001;
    assert.equal((await client.send(event)).duplicate, true);
    assert.equal(logins, 2);
    forced = true;
    await client.send(event);
    assert.equal(logins, 3);
    assert.equal(repo.list().length, 1);
    await assert.rejects(() => client.send({ ...event, evento: 'FacturaGenerada' }), /403/);
    const result = await handleAuthRequest({ content: Buffer.from(JSON.stringify({ usuario: 'pagos', password: 'test-password-worker-long' })) }, access);
    assert.equal(result.data.expira_en_segundos, 1800);
    assert.equal(result.data.token, result.data.access_token);
  } finally { repo.close(); }
});
