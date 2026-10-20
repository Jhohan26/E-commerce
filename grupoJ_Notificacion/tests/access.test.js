import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { NotificationRepository } from '../src/repositories/notificationRepository.js';
import { AccessService } from '../src/services/accessService.js';
import { createApp } from '../src/app.js';
import { handleDelivery } from '../src/consumers/handler.js';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const event = { evento: 'PagoAprobado', pedidoId: 22, clienteId: 1, fecha: '2026-10-19T12:00:00Z' };
async function fixture() {
  const repo = new NotificationRepository(':memory:');
  let now = Date.now();
  const secret = randomBytes(48).toString('base64url');
  const access = new AccessService(repo.db, { secret, idleSeconds: 60, lifetimeSeconds: 300 }, () => now);
  await access.provision('pagos', 'test-password-at-least-16', 'module', ['PagoAprobado', 'PagoRechazado']);
  await access.provision('administrador', 'admin-password-at-least-16', 'admin');
  return { repo, access, secret, advance(ms) { now += ms; } };
}
test('Token reutilizable, firma y permisos, caducidad por inactividad y duración máxima', async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.access.login('pagos', 'contraseña incorrecta'), /Credenciales/);
    const { token } = await f.access.login('pagos', 'test-password-at-least-16');
    assert.equal(f.access.authenticate(token, { event: 'PagoAprobado' }).username, 'pagos');
    assert.throws(() => f.access.authenticate(token, { event: 'PedidoCreado' }), e => e.status === 403);
    assert.throws(() => f.access.authenticate(token, { admin: true }), e => e.status === 403);
    const forged = jwt.sign({ sub: 'pagos', jti: 'fake' }, 'otra-clave', { algorithm: 'HS256' });
    assert.throws(() => f.access.authenticate(forged));
    f.advance(59000); f.access.authenticate(token);
    f.advance(59000); f.access.authenticate(token);
    f.advance(61000); assert.throws(() => f.access.authenticate(token), /Sesión/);
    const session = await f.access.login('pagos', 'test-password-at-least-16');
    for (let i = 0; i < 5; i++) { f.advance(50000); f.access.authenticate(session.token); }
    f.advance(50001); assert.throws(() => f.access.authenticate(session.token));
  } finally { f.repo.close(); }
});
test('Bloqueo de login, revocación y rotación de contraseña', async () => {
  const f = await fixture();
  try {
    const first = await f.access.login('pagos', 'test-password-at-least-16', 'first');
    f.access.revoke(f.access.authenticate(first.token).sessionId);
    assert.throws(() => f.access.authenticate(first.token));
    const second = await f.access.login('pagos', 'test-password-at-least-16', 'second');
    await f.access.provision('pagos', 'replacement-password-16', 'module', ['PagoAprobado']);
    assert.throws(() => f.access.authenticate(second.token));
    for (let i = 0; i < 10; i++) await assert.rejects(() => f.access.login('desconocido', 'incorrecta', 'attacker'));
    await assert.rejects(() => f.access.login('administrador', 'admin-password-at-least-16', 'attacker'), e => e.status === 429);
  } finally { f.repo.close(); }
});
test('API protege bandeja; módulos solo crean eventos permitidos; logout invalida JWT', async () => {
  const f = await fixture();
  const server = createApp(f.repo, () => true, console, { access: f.access, emailEnabled: true }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, token) => fetch(base + path, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/api/notificaciones')).status, 401);
    const login = await post('/api/auth/login', { username: 'pagos', password: 'test-password-at-least-16' });
    const { access_token: token } = await login.json();
    assert.equal((await fetch(base + '/api/notificaciones', { headers: { Authorization: `Bearer ${token}` } })).status, 403);
    assert.equal((await post('/api/eventos', event, token)).status, 201);
    assert.equal((await post('/api/eventos', event, token)).status, 200);
    assert.equal((await post('/api/eventos', { ...event, evento: 'PedidoCreado' }, token)).status, 403);
    assert.equal((await post('/api/eventos', event)).status, 401);
    const admin = await post('/api/auth/login', { username: 'administrador', password: 'admin-password-at-least-16' });
    assert.match(admin.headers.get('set-cookie'), /HttpOnly/);
    const cookie = admin.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/api/notificaciones', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await post('/api/auth/logout', {}, token)).status, 200);
    assert.equal((await post('/api/eventos', event, token)).status, 401);
    assert.equal(f.repo.nextEmail().state, 'pending');
  } finally { await new Promise(resolve => server.close(resolve)); f.repo.close(); }
});
test('RabbitMQ rechaza mensajes sin JWT y permite solo los eventos de la cuenta', async () => {
  const f = await fixture();
  try {
    const { token } = await f.access.login('pagos', 'test-password-at-least-16');
    for (const [authorization, expected] of [[undefined, 'nack'], ['Bearer basura', 'nack'], [`Bearer ${token}`, 'ack']]) {
      let outcome;
      handleDelivery({ content: Buffer.from(JSON.stringify(event)), properties: { headers: { authorization } } },
        { ack() { outcome = 'ack'; }, nack() { outcome = 'nack'; } },
        { process() { return { notification: { id: 1 }, duplicate: false }; } }, { info() {}, error() {} }, { access: f.access });
      assert.equal(outcome, expected);
    }
    let accepted = false;
    handleDelivery({ content: Buffer.from(JSON.stringify(event)), properties: { headers: { Authorization: `Bearer ${token}` } } },
      { ack() { accepted = true; }, nack() { assert.fail('Cabecera Authorization válida'); } },
      { process() { return { notification: { id: 1 }, duplicate: false }; } }, { info() {}, error() {} }, { access: f.access });
    assert.equal(accepted, true);
  } finally { f.repo.close(); }
});
test('Panel requiere login, usa cookie y cierra sesión sin exponer JWT en almacenamiento', async () => {
  const f = await fixture();
  const server = createApp(f.repo, () => true, console, { access: f.access }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dom = new JSDOM(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), { url: base, runScripts: 'outside-only' });
  let cookie = '';
  dom.window.fetch = async (path, options = {}) => {
    const res = await fetch(new URL(path, base), { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}) } });
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    return res;
  };
  const until = async condition => {
    for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 20)); }
    assert.fail('Panel no alcanzó el estado esperado');
  };
  try {
    dom.window.eval(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'));
    await new Promise(r => setTimeout(r, 50));
    assert.equal(dom.window.document.querySelector('main').hidden, true);
    dom.window.document.querySelector('#access-user').value = 'administrador';
    dom.window.document.querySelector('#access-password').value = 'admin-password-at-least-16';
    dom.window.document.querySelector('#access-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await until(() => !dom.window.document.querySelector('main').hidden);
    assert.equal(dom.window.localStorage.length, 0);
    assert.equal(dom.window.document.querySelector('#access-password').value, '');
    dom.window.document.querySelector('#access-logout').click();
    await until(() => dom.window.document.querySelector('main').hidden);
    assert.equal((await fetch(base + '/api/notificaciones', { headers: { Cookie: cookie } })).status, 401);
  } finally { dom.window.close(); await new Promise(resolve => server.close(resolve)); f.repo.close(); }
});
