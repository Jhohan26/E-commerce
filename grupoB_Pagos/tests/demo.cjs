'use strict';

// DOM y reloj simulados: no abre conexiones ni espera un minuto real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const timers = [];
const intervals = [];
const nameTarget = { dataset: { orderId: '1028' }, isConnected: true, textContent: '' };
const container = {
  dataset: { pedido: '1028' },
  querySelector: selector => selector === '[data-client-name]' ? nameTarget : {}
};
const elements = {
  'result-container': container,
  'pending-list': { replaceChildren() {} },
  'pending-count': {},
  'pending-status': {},
  main: { classList: { add() {} } }
};
let pendingCalls = 0;
let clientCalls = 0;
let finishClient;
let clientSignal;
const context = {
  AbortController,
  Intl,
  document: {
    hidden: false,
    getElementById: id => elements[id],
    querySelectorAll: () => [],
    createDocumentFragment: () => ({ append() {} }),
    createElement: () => ({}),
    addEventListener() {}
  },
  window: {
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
    setInterval: (callback, delay) => intervals.push({ callback, delay })
  },
  fetch: (url, options) => {
    if (url.startsWith('client.php')) {
      clientCalls++;
      clientSignal = options.signal;
      return new Promise(resolve => { finishClient = resolve; });
    }
    assert.equal(url, 'pending.php');
    pendingCalls++;
    return Promise.resolve({ ok: true, json: async () => ({ rows: [], total: 0 }) });
  }
};
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../public/demo.js'), 'utf8'), context);
  await flush();
  assert.equal(pendingCalls, 1);
  assert.equal(clientCalls, 1);
  assert.ok(timers.some(timer => timer.delay === 60000), 'el nombre admite login y consulta RPC');
  assert.equal(clientSignal.aborted, false);
  // Una segunda actualización debe terminar aunque el primer nombre no llegue.
  for (const interval of intervals) void interval.callback();
  await flush();
  assert.equal(pendingCalls, 2, 'un nombre lento no bloquea los pendientes');
  assert.equal(clientCalls, 1, 'consultas simultáneas del mismo nombre se agrupan');
  finishClient({ ok: true, json: async () => ({ status: 'ok', name: 'Ana Ortiz' }) });
  await flush();
  assert.equal(nameTarget.textContent, 'Ana Ortiz', 'el nombre recibido se muestra en la web');
  console.log('OK nombre lento, pendientes independientes, consulta única y nombre visible');
})().catch(error => { console.error(error); process.exitCode = 1; });
