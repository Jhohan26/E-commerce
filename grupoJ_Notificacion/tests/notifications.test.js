import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotificationRepository } from '../src/repositories/notificationRepository.js';
import { NotificationService } from '../src/services/notificationService.js';
import { eventTypes, InvalidEventError } from '../src/models/event.js';
import { handleDelivery } from '../src/consumers/handler.js';
import { createApp } from '../src/app.js';
import { DatabaseSync } from 'node:sqlite';
const fixture = type => JSON.parse(readFileSync(new URL(`../examples/${type}.json`, import.meta.url)));
const log = { info() {}, error() {} };
test('Migra la base anterior sin perder lectura, ids ni deduplicación', () => {
  const folder = mkdtempSync(join(tmpdir(), 'grupo-j-migracion-'));
  const path = join(folder, 'legacy.sqlite');
  let repo;
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE notificaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clienteId INTEGER NOT NULL, pedidoId INTEGER NOT NULL,
      tipoEvento TEXT NOT NULL, titulo TEXT NOT NULL, mensaje TEXT NOT NULL,
      fecha TEXT NOT NULL, leida INTEGER NOT NULL DEFAULT 0 CHECK(leida IN (0,1)),
      claveEvento TEXT NOT NULL UNIQUE, fechaEvento TEXT NOT NULL);
      CREATE INDEX idx_cliente ON notificaciones(clienteId, id);`);
    legacy.prepare('INSERT INTO notificaciones VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      7, 25, 1001, 'PedidoCreado', 'Pedido recibido', 'Mensaje conservado',
      '2026-10-02T10:00:00Z', 1, 'clave-anterior', '2026-10-01T10:30:00');
    legacy.close();
    repo = new NotificationRepository(path);
    const item = repo.get(7);
    assert.equal(item.clienteId, 25);
    assert.equal(item.pedidoId, 1001);
    assert.equal(item.leida, true);
    assert.equal(item.mensaje, 'Mensaje conservado');
    assert.equal(repo.list({ clienteId: 25 }).length, 1);
    assert.equal(repo.save(fixture('PedidoCreado'), { titulo: 'Otro', mensaje: 'Otro' }, 'clave-anterior').duplicate, true);
    assert.equal(repo.db.prepare('SELECT Cliente_id, Pedido_id FROM Notificacion WHERE id=7').get().Pedido_id, 1001);
    assert.ok(new NotificationService(repo).process(fixture('PagoAprobado')).notification.id > 7);
    repo.close(); repo = new NotificationRepository(path);
    assert.equal(repo.list().length, 2);
    assert.equal(repo.get(7).leida, true);
  } finally { repo?.close(); rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
for (const type of eventTypes) test(`Recepción, guardado y ACK de ${type}`, () => {
  const repo = new NotificationRepository(':memory:');
  try {
    let acknowledged = false;
    const message = { content: Buffer.from(JSON.stringify(fixture(type))) };
    handleDelivery(message, {
      ack(m) { assert.equal(m, message); assert.equal(repo.list().length, 1); acknowledged = true; },
      nack() { assert.fail('No debe rechazar'); }
    }, new NotificationService(repo), log);
    assert.equal(acknowledged, true);
    const item = repo.list()[0];
    assert.equal(item.tipoEvento, type); assert.equal(item.clienteId, 25);
    assert.match(item.mensaje, new RegExp(`#${fixture(type).pedidoId}`));
    assert.equal(item.leida, false);
  } finally { repo.close(); }
});
test('Persistencia al cerrar y abrir la base de datos', () => {
  const folder = mkdtempSync(join(tmpdir(), 'grupo-j-'));
  let repo;
  try {
    const path = join(folder, 'test.sqlite');
    repo = new NotificationRepository(path);
    new NotificationService(repo).process(fixture('PedidoCreado'));
    repo.close(); repo = new NotificationRepository(path);
    assert.equal(repo.list().length, 1);
  } finally { repo?.close(); rmSync(folder, { recursive: true, force: true }); }
});
test('Redelivery y orden de campos no duplican la notificación', () => {
  const repo = new NotificationRepository(':memory:');
  try {
    const service = new NotificationService(repo), event = fixture('PedidoCreado');
    assert.equal(service.process(event).duplicate, false);
    assert.equal(service.process(Object.fromEntries(Object.entries(event).reverse())).duplicate, true);
    assert.equal(repo.list().length, 1);
  } finally { repo.close(); }
});
test('JSON inválido y contrato inválido se rechazan sin ACK', () => {
  const repo = new NotificationRepository(':memory:');
  try {
    for (const payload of ['{', JSON.stringify(fixture('Invalido')), JSON.stringify({ ...fixture('PedidoCreado'), evento: 'Desconocido' })]) {
      let rejected = false;
      handleDelivery({ content: Buffer.from(payload) }, {
        ack() { assert.fail('No debe confirmar'); },
        nack(m, multiple, requeue) { assert.equal(multiple, false); assert.equal(requeue, false); rejected = true; }
      }, new NotificationService(repo), log);
      assert.equal(rejected, true);
    }
    assert.equal(repo.list().length, 0);
  } finally { repo.close(); }
});
test('Fallo de almacenamiento no confirma ni descarta: solicita recuperación', () => {
  assert.throws(() => handleDelivery({ content: Buffer.from(JSON.stringify(fixture('PedidoCreado'))) }, {
    ack() { assert.fail('ACK prematuro'); }, nack() { assert.fail('No debe descartar'); }
  }, { process() { throw new Error('DB no disponible'); } }, log), /DB no disponible/);
});
test('Validación de campos, fecha y productos', () => {
  const repo = new NotificationRepository(':memory:');
  try {
    const service = new NotificationService(repo), event = fixture('PedidoCreado');
    for (const patch of [{ fecha: '2026-02-30T12:00:00' }, { clienteId: -1 }, { total: -2 }, { productos: [] }, { productos: [{ productoId: 1, cantidad: 0, precio: 2 }] }]) {
      assert.throws(() => service.process({ ...event, ...patch }), InvalidEventError);
    }
  } finally { repo.close(); }
});
test('API HTTP: lista, cliente, detalle, leída, paginación y errores', async () => {
  const repo = new NotificationRepository(':memory:');
  const service = new NotificationService(repo);
  for (const type of eventTypes) service.process(fixture(type));
  service.process({ ...fixture('PagoAprobado'), pedidoId: 2000, clienteId: 99 });
  const server = createApp(repo, () => true, log).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = path => fetch(base + path);
  try {
    assert.equal((await (await get('/api/notificaciones')).json()).length, 6);
    assert.equal((await (await get('/api/notificaciones/cliente/25')).json()).length, 5);
    assert.equal((await (await get('/api/notificaciones/cliente/99')).json()).length, 1);
    assert.equal((await (await get('/api/notificaciones?limit=2&offset=1')).json()).length, 2);
    const item = await (await get('/api/notificaciones/1')).json(); assert.equal(item.leida, false);
    const read = await fetch(base + '/api/notificaciones/1/leida', { method: 'PATCH' }); assert.equal((await read.json()).leida, true);
    assert.equal((await get('/api/notificaciones/900')).status, 404);
    assert.equal((await get('/api/notificaciones/no')).status, 400);
    assert.equal((await get('/api/notificaciones/cliente/-1')).status, 400);
    assert.equal((await get('/api/notificaciones?limit=0')).status, 400);
    assert.equal((await get('/health/ready')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); repo.close(); }
});
