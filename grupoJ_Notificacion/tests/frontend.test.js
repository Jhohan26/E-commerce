import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { NotificationRepository } from '../src/repositories/notificationRepository.js';
import { NotificationService } from '../src/services/notificationService.js';
import { createApp } from '../src/app.js';
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
test('Frontend muestra estados de correo y los conserva al marcar como leída', async t => {
  const ui = await setup(t, 4);
  const items = ui.repo.list();
  const insert = ui.repo.db.prepare('INSERT INTO EmailJob(notificationId,messageId,state,attempts,lastError) VALUES (?,?,?,?,?)');
  insert.run(items[0].id, 'pending', 'pending', 1, 'CLIENT_RPC_TIMEOUT');
  insert.run(items[1].id, 'accepted', 'accepted', 0, null);
  insert.run(items[2].id, 'failed', 'failed', 5, 'CLIENT_RECIPIENT_INVALID');
  await ui.apply();
  const statuses = () => [...ui.dom.window.document.querySelectorAll('.email-status')].map(n => n.textContent);
  assert.ok(statuses().some(s => s.includes('Correo pendiente') && s.includes('Clientes no respondió')));
  assert.ok(statuses().some(s => s.includes('Correo aceptado por el proveedor')));
  assert.ok(statuses().some(s => s.includes('Correo fallido') && s.includes('Cliente o correo no válido')));
  assert.ok(statuses().some(s => s.includes('Correo no programado')));
  ui.query('.mark-read').click();
  await until(() => ui.query('#read').textContent === '1');
  assert.ok(statuses().some(s => s.includes('Correo pendiente')));
});
async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 15)); }
  assert.fail('La interfaz no alcanzó el estado esperado');
}
async function setup(t, count = 5) {
  const repo = new NotificationRepository(':memory:');
  const service = new NotificationService(repo);
  const types = ['PedidoCreado', 'PagoAprobado', 'PagoRechazado', 'FacturaGenerada', 'InventarioInsuficiente'];
  for (let i = 0; i < count; i++) {
    const event = JSON.parse(readFileSync(new URL(`../examples/${types[i % 5]}.json`, import.meta.url)));
    service.process({ ...event, pedidoId: 1000 + i, clienteId: i % 2 ? 99 : 25 });
  }
  const server = createApp(repo, () => true).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dom = new JSDOM(html, { url: base, runScripts: 'outside-only' });
  let fail = false;
  dom.window.fetch = (path, options) => fail && path.startsWith('/api/')
    ? Promise.reject(new Error('Fallo de red simulado')) : fetch(new URL(path, base), options);
  t.after(async () => { dom.window.close(); await new Promise(resolve => server.close(resolve)); repo.close(); });
  dom.window.eval(script);
  const query = selector => dom.window.document.querySelector(selector);
  await until(() => query('#list').getAttribute('aria-busy') === 'false');
  return { dom, query, repo, fail: value => { fail = value; }, change(selector, value) {
    query(selector).value = value; query(selector).dispatchEvent(new dom.window.Event('change'));
  }, async apply() {
    query('#filters').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await until(() => query('#list').getAttribute('aria-busy') === 'false');
  } };
}
test('Frontend: carga real, filtros, marcado persistido, cliente y estado vacío', async t => {
  const ui = await setup(t);
  assert.equal(ui.dom.window.document.querySelectorAll('.notification').length, 5);
  assert.equal(ui.query('#unread').textContent, '5');
  await until(() => ui.query('#connection').textContent.includes('conectado'));
  ui.change('#event', 'PagoAprobado');
  assert.equal(ui.dom.window.document.querySelectorAll('.notification').length, 1);
  ui.query('.mark-read').click();
  await until(() => ui.query('#read').textContent === '1');
  assert.equal(ui.repo.list().filter(row => row.leida).length, 1);
  ui.change('#state', 'unread'); assert.ok(ui.query('.empty'));
  ui.change('#event', ''); ui.change('#state', '');
  ui.query('#client').value = '25'; await ui.apply();
  assert.equal(ui.query('#total').textContent, '3');
  ui.query('#client').value = '123456'; await ui.apply();
  assert.equal(ui.query('#total').textContent, '0'); assert.ok(ui.query('.empty'));
});
test('Frontend: paginación y recuperación de una consulta fallida', async t => {
  const ui = await setup(t, 101);
  assert.equal(ui.query('#total').textContent, '100');
  ui.fail(true); ui.query('#next').click();
  await until(() => ui.query('#list').getAttribute('aria-busy') === 'false');
  assert.match(ui.query('#notice').textContent, /Fallo de red/);
  assert.match(ui.query('#page-info').textContent, /Página 1/);
  assert.equal(ui.query('#total').textContent, '100');
  ui.fail(false); ui.query('#next').click();
  await until(() => ui.query('#list').getAttribute('aria-busy') === 'false');
  assert.equal(ui.query('#total').textContent, '1'); assert.match(ui.query('#page-info').textContent, /Página 2/);
  ui.query('#previous').click(); await until(() => ui.query('#list').getAttribute('aria-busy') === 'false');
  assert.equal(ui.query('#total').textContent, '100');
});
test('Frontend: error al marcar como leída conserva estado y permite reintentar', async t => {
  const ui = await setup(t, 1);
  ui.fail(true); ui.query('.mark-read').click();
  await until(() => ui.query('#notice').textContent.includes('Fallo de red'));
  assert.equal(ui.repo.get(1).leida, false); assert.equal(ui.query('.mark-read').disabled, false);
  ui.fail(false); ui.query('.mark-read').click();
  await until(() => ui.query('#read').textContent === '1');
  assert.equal(ui.repo.get(1).leida, true);
});

test('Frontend: actualizar durante el guardado espera y conserva contador al recargar', async t => {
  const ui = await setup(t, 2);
  const originalFetch = ui.dom.window.fetch;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let gets = 0;
  ui.dom.window.fetch = async (path, options) => {
    if (options?.method === 'PATCH') await gate;
    else if (path.startsWith('/api/')) gets++;
    return originalFetch(path, options);
  };
  ui.query('.mark-read').click();
  ui.query('#refresh').click();
  assert.equal(gets, 0);
  release();
  await until(() => gets === 1 && ui.query('#list').getAttribute('aria-busy') === 'false');
  assert.equal(ui.query('#read').textContent, '1');
  assert.equal(ui.query('#unread').textContent, '1');
  const reloaded = new JSDOM(html, { url: ui.dom.window.location.href, runScripts: 'outside-only' });
  try {
    reloaded.window.fetch = originalFetch;
    reloaded.window.eval(script);
    await until(() => reloaded.window.document.querySelector('#read').textContent === '1');
    assert.equal(ui.repo.list().filter(row => row.leida).length, 1);
    const response = await originalFetch('/api/notificaciones');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { reloaded.window.close(); }
});
