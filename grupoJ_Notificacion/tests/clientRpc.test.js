import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientRpc } from '../src/services/clientRpc.js';
import { loadConfig } from '../src/config/config.js';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const config = { rabbitUrl: 'amqps://example.test/vhost', email: { rpcTimeoutMs: 1000 },
  clientRpc: { username: 'modulo-prueba', password: 'clave-de-prueba', loginQueue: 'auth.login', queryQueue: 'cliente.consultar' } };
const login = token => ({ status: 200, data: { token, expira_en_segundos: 1800 } });
const client = id => ({ status: 200, data: { id, estado: 1, correo: 'cliente@example.test' } });
test('Plantilla de integración usa pagos_exchange y separa el broker de Clientes', () => {
  const env = parseEnv(readFileSync(new URL('../.env.integracion.example', import.meta.url), 'utf8'));
  const settings = loadConfig({ ...env, RABBITMQ_URL: 'amqps://eventos.test/v', CLIENTES_RABBITMQ_URL: 'amqps://clientes.test/v' });
  const source = settings.sources.find(source => source.exchange === 'pagos_exchange');
  assert.equal(source.type, 'topic');
  assert.deepEqual(source.keys, ['pago.aprobado', 'pago.rechazado']);
  assert.equal(settings.clientRpc.rabbitUrl, 'amqps://clientes.test/v');
  assert.equal(settings.clientRpc.loginQueue, 'auth.login');
  assert.equal(settings.clientRpc.queryQueue, 'cliente.consultar');
  assert.throws(() => loadConfig({ ...env, CLIENTES_RABBITMQ_URL: 'amqp://inseguro.test/v' }), /Protocolo de Clientes/);
});
test('Login de Clientes usa usuario/password y reutiliza su token en consultas posteriores', async () => {
  const calls = [];
  const rpc = new ClientRpc(config, { transport: async (queue, body, token) => {
    calls.push({ queue, body, token });
    if (queue === 'auth.login') return login('token-clientes');
    assert.equal(token, 'token-clientes'); return client(body.id);
  } });
  await rpc.getClient(1); await rpc.getClient(10);
  assert.equal(calls.filter(c => c.queue === 'auth.login').length, 1);
  assert.deepEqual(calls[0].body, { usuario: 'modulo-prueba', password: 'clave-de-prueba' });
  assert.equal(calls[0].token, undefined);
  assert.deepEqual(calls[1].body, { id: 1 });
});
test('Token de Clientes se renueva antes de vencer y una vez tras respuesta 401', async () => {
  let now = 0, logins = 0, expired = false;
  const rpc = new ClientRpc(config, { clock: () => now, transport: async (queue, body, token) => {
    if (queue === 'auth.login') return login(`token-${++logins}`);
    if (expired) { expired = false; return { status: 401 }; }
    return client(body.id);
  } });
  await rpc.getClient(1); now = 1800000; await rpc.getClient(1);
  assert.equal(logins, 2);
  expired = true; await rpc.getClient(1); assert.equal(logins, 3);
});
test('Consultas simultáneas comparten un único login', async () => {
  let logins = 0;
  const rpc = new ClientRpc(config, { transport: async (queue, body) => {
    if (queue === 'auth.login') { logins++; await new Promise(resolve => setTimeout(resolve, 10)); return login('token'); }
    return client(body.id);
  } });
  await Promise.all([rpc.getClient(1), rpc.getClient(2)]);
  assert.equal(logins, 1);
});
test('Credenciales faltantes o rechazadas no permiten consulta anónima', async () => {
  const missing = new ClientRpc({ ...config, clientRpc: {} }, { transport: () => assert.fail('No enviar sin credenciales') });
  await assert.rejects(() => missing.getClient(1), /CLIENT_AUTH_NOT_CONFIGURED/);
  const invalid = new ClientRpc(config, { transport: async () => ({ status: 401, error: 'detalle privado' }) });
  await assert.rejects(() => invalid.getClient(1), error => error.message === 'CLIENT_AUTH_REJECTED');
  let calls = 0;
  const repeated = new ClientRpc(config, { transport: async queue => { calls++; return queue === 'auth.login' ? login('token') : { status: 401 }; } });
  await assert.rejects(() => repeated.getClient(1), /CLIENT_AUTH_REJECTED/);
  assert.equal(calls, 4);
});
test('Valida identidad, estado y destinatario antes de enviar correo', async () => {
  for (const [response, code] of [
    [{ status: 404 }, 'CLIENT_NOT_FOUND'],
    [client(2), 'CLIENT_RESPONSE_INVALID'],
    [{ status: 200, data: { id: 1, estado: 0, correo: 'cliente@example.test' } }, 'CLIENT_INACTIVE'],
    [{ status: 200, data: { id: 1, estado: 1, correo: 'a@b.test,b@c.test' } }, 'CLIENT_EMAIL_INVALID'],
    [{ status: 500 }, 'CLIENT_RESPONSE_INVALID']
  ]) {
    const rpc = new ClientRpc(config, { transport: async queue => queue === 'auth.login' ? login('token') : response });
    await assert.rejects(() => rpc.getClient(1), error => error.message === code);
  }
});
