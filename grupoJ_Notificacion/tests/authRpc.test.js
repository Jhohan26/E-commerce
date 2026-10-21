import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationRepository } from '../src/repositories/notificationRepository.js';
import { AccessService } from '../src/services/accessService.js';
import { handleAuthRequest } from '../src/consumers/authRpc.js';

test('RPC emite JWT del módulo, conserva permisos y rechaza administrador sin crear sesión', async () => {
  const repo = new NotificationRepository(':memory:');
  try {
    const access = new AccessService(repo.db, { secret: 'x'.repeat(48) });
    await access.provision('pagos', 'test-password-long-enough', 'module', ['PagoAprobado']);
    await access.provision('administrador', 'test-admin-password-long', 'admin');
    const request = body => handleAuthRequest({ content: Buffer.from(JSON.stringify(body)) }, access);
    const response = await request({ username: 'pagos', password: 'test-password-long-enough' });
    assert.equal(response.status, 200);
    assert.equal(access.authenticate(response.data.access_token, { event: 'PagoAprobado' }).username, 'pagos');
    assert.throws(() => access.authenticate(response.data.access_token, { admin: true }), e => e.status === 403);
    assert.throws(() => access.authenticate(response.data.access_token, { event: 'PedidoCreado' }), e => e.status === 403);
    assert.equal((await request({ username: 'pagos', password: 'wrong' })).status, 401);
    assert.equal((await request({ username: 'administrador', password: 'test-admin-password-long' })).status, 403);
    assert.equal(repo.db.prepare("SELECT count(*) AS n FROM AccessSession WHERE username='administrador'").get().n, 0);
    assert.equal((await request({})).status, 400);
    assert.equal((await handleAuthRequest({ content: Buffer.from('{') }, access)).status, 400);
    assert.equal((await handleAuthRequest({ content: Buffer.alloc(4097) }, access)).status, 413);
  } finally { repo.close(); }
});
