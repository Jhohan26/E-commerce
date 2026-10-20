import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/config.js';
import { assertTopology } from '../src/config/topology.js';
import { handleDelivery } from '../src/consumers/handler.js';
import { NotificationRepository } from '../src/repositories/notificationRepository.js';
import { NotificationService } from '../src/services/notificationService.js';
const sources = [
  { exchange: 'pedidos_exchange', type: 'fanout', keys: [''], events: ['PedidoCreado'] },
  { exchange: 'ecommerce.eventos', type: 'topic', keys: ['pago.aprobado'], events: ['PagoAprobado'] },
  { exchange: 'inventario_exchange', type: 'fanout', keys: [''], events: ['InventarioInsuficiente'] }
];
test('Pago del exchange real se guarda antes de confirmar y no se duplica', () => {
  const repository = new NotificationRepository(':memory:');
  try {
    const event = { evento: 'PagoAprobado', pedidoId: 10, clienteId: 25, pagoId: 7,
      total: 100, estado: 'APROBADO', fecha: '2026-10-07T12:00:00Z' };
    const message = { content: Buffer.from(JSON.stringify(event)),
      fields: { exchange: 'ecommerce.eventos', routingKey: 'pago.aprobado' } };
    let acks = 0;
    for (let i = 0; i < 2; i++) handleDelivery(message,
      { ack() { assert.equal(repository.list().length, 1); acks++; }, nack() { assert.fail('Pago compatible'); } },
      new NotificationService(repository), { info() {}, error() {} }, { sources });
    assert.equal(acks, 2);
    assert.equal(repository.list()[0].clienteId, 25);
  } finally { repository.close(); }
});
test('Enlaza una cola propia a exchanges distintos sin cambiar sus tipos', async () => {
  const calls = [];
  const channel = Object.fromEntries(['assertExchange', 'assertQueue', 'bindQueue'].map(name =>
    [name, async (...args) => calls.push([name, ...args])]));
  await assertTopology(channel, { queue: 'j', sources });
  assert.ok(calls.some(c => c[0] === 'assertExchange' && c[1] === 'pedidos_exchange' && c[2] === 'fanout'));
  assert.ok(calls.some(c => c[0] === 'bindQueue' && c[1] === 'j' && c[2] === 'ecommerce.eventos' && c[3] === 'pago.aprobado'));
  assert.equal(calls.filter(c => c[0] === 'bindQueue' && c[1] === 'j').length, 3);
});
test('Exige TLS cuando corresponde y valida fuentes', () => {
  assert.throws(() => loadConfig({ RABBITMQ_REQUIRE_TLS: 'true' }), /AMQPS/);
  assert.throws(() => loadConfig({ RABBITMQ_SOURCES: '[{}]' }), /fuentes/);
  assert.equal(loadConfig({ RABBITMQ_URL: 'amqps://example.test/v', RABBITMQ_REQUIRE_TLS: 'true',
    RABBITMQ_SOURCES: JSON.stringify(sources) }).sources.length, 3);
});
test('Filtra inventario y rechaza origen, evento y tamaño incorrectos', () => {
  for (const [exchange, routingKey, evento, maxMessageBytes, expected] of [
    ['inventario_exchange', '', 'InventarioActualizado', 1000, 'ack'],
    ['inventario_exchange', '', 'Desconocido', 1000, 'nack'],
    ['ecommerce.eventos', 'pago.aprobado', 'PedidoCreado', 1000, 'nack'],
    ['otro', '', 'PagoAprobado', 1000, 'nack'],
    ['ecommerce.eventos', 'otra', 'PagoAprobado', 1000, 'nack'],
    ['ecommerce.eventos', 'pago.aprobado', 'PagoAprobado', 1, 'nack']
  ]) {
    let result;
    handleDelivery({ content: Buffer.from(JSON.stringify({ evento })), fields: { exchange, routingKey } },
      { ack() { result = 'ack'; }, nack(m, all, requeue) { assert.equal(requeue, false); result = 'nack'; } },
      { process() { assert.fail('No procesar eventos filtrados'); } }, { info() {}, error() {} }, { sources, maxMessageBytes });
    assert.equal(result, expected);
  }
});
