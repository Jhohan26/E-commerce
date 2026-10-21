import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { NotificationRepository } from '../src/repositories/notificationRepository.js';
import { AccessService } from '../src/services/accessService.js';
import { PlatformAccess } from '../src/services/platformAccess.js';
import { createApp } from '../src/app.js';
import { handleDelivery } from '../src/consumers/handler.js';

function fixture() {
  const repo = new NotificationRepository(':memory:');
  let now = Date.now();
  const secret = randomBytes(48).toString('base64url');
  const local = new AccessService(repo.db, { secret: randomBytes(48).toString('base64url'), idleSeconds: 60 }, () => now);
  const sign = (claims = {}, options = {}) => jwt.sign({ sub: 'demo', role: 'administrador',
    iat: Math.floor(now / 1000), ...claims }, secret, { algorithm: 'HS256', expiresIn: 3600,
    issuer: 'clientes-laboratorio', ...options });
  const rpc = { settings: { loginQueue: 'auth.login' }, async request(queue, payload) {
    assert.equal(queue, 'auth.login');
    return payload.usuario === 'demo' && payload.password === 'correcta'
      ? { status: 200, data: { token: sign() } } : { status: 401 };
  } };
  const access = new PlatformAccess(local, rpc, { mode: 'clientes', secret, issuer: 'clientes-laboratorio' }, () => now);
  return { repo, local, access, sign, secret, advance(ms) { now += ms; } };
}

test('JWT externo verifica firma, expiración, emisor, claims y rol sin aceptar datos del cuerpo', () => {
  const f = fixture();
  try {
    assert.equal(f.access.authenticate(f.sign(), { admin: true }).platformRole, 'administrador');
    for (const role of ['cliente', 'operador']) {
      assert.throws(() => f.access.authenticate(f.sign({ role }), { admin: true }), e => e.status === 403);
    }
    for (const token of [f.sign() + 'x', f.sign({}, { expiresIn: -1 }),
      f.sign({}, { issuer: 'otro' }), f.sign({ role: undefined }), f.sign({ role: 'administrador', rol: 'cliente' }),
      jwt.sign({ sub: 'demo', role: 'administrador', iss: 'clientes-laboratorio' }, f.secret),
      jwt.sign({ sub: 'demo', role: 'administrador' }, f.secret, { algorithm: 'HS384', expiresIn: 100, issuer: 'clientes-laboratorio' })]) {
      assert.throws(() => f.access.authenticate(token, { admin: true }), e => e.status === 401);
    }
    assert.throws(() => f.access.authenticate(f.sign(), { event: 'PagoAprobado' }), e => e.status === 401);
  } finally { f.repo.close(); }
});

test('Login se delega a F; inactividad y logout local no reactivan la misma sesión externa', async () => {
  const f = fixture();
  try {
    await assert.rejects(() => f.access.login('demo', 'incorrecta'), e => e.status === 401);
    await assert.rejects(() => f.access.login('inexistente', 'correcta'), e => e.status === 401);
    const session = await f.access.login('demo', 'correcta');
    const identity = f.access.authenticate(session.token, { admin: true });
    f.access.revoke(identity.sessionId);
    assert.throws(() => f.access.authenticate(session.token), e => e.status === 401);
    f.advance(1000);
    const next = f.sign();
    f.access.authenticate(next);
    f.advance(60001);
    assert.throws(() => f.access.authenticate(next), e => e.status === 401);
  } finally { f.repo.close(); }
});

test('API administrativa aplica los siete casos del laboratorio con JWT de emisor externo', async () => {
  const f = fixture();
  const server = createApp(f.repo, () => true, console, { access: f.access }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const query = token => fetch(base + '/api/notificaciones', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  try {
    assert.equal((await fetch(base + '/health/live')).status, 200);
    assert.equal((await query()).status, 401);
    assert.equal((await query(f.sign())).status, 200);
    assert.equal((await query(f.sign() + 'x')).status, 401);
    assert.equal((await query(f.sign({}, { expiresIn: -1 }))).status, 401);
    assert.equal((await query(f.sign({ role: 'operador' }))).status, 403);
    assert.equal((await query(f.sign({ sub: 'admin-dos' }))).status, 200);
    const result = await fetch(base + '/api/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'correcta', role: 'administrador' }) });
    assert.equal(result.status, 200);
    assert.match(result.headers.get('set-cookie'), /HttpOnly/);
  } finally { await new Promise(resolve => server.close(resolve)); f.repo.close(); }
});

test('RabbitMQ mantiene los productores existentes sin confundir el JWT HTTP con la conexión al broker', () => {
  let ack = false;
  handleDelivery({ content: Buffer.from(JSON.stringify({ evento: 'PagoAprobado' })),
    fields: { exchange: 'pagos_exchange', routingKey: 'pago.aprobado' } },
  { ack() { ack = true; }, nack() { assert.fail('No debe exigir JWT de usuario al evento del broker'); } },
  { process() { return { notification: { id: 1 }, duplicate: false }; } }, { info() {}, error() {} },
  { requireEventJwt: false, sources: [{ exchange: 'pagos_exchange', type: 'topic', keys: ['pago.aprobado'], events: ['PagoAprobado'] }] });
  assert.equal(ack, true);
});
