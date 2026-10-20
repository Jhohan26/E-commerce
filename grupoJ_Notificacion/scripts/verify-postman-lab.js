import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { NotificationRepository } from '../src/repositories/notificationRepository.js';
import { AccessService } from '../src/services/accessService.js';
import { PlatformAccess } from '../src/services/platformAccess.js';
import { createApp } from '../src/app.js';

const require = createRequire(resolve('.artifacts/postman-tools/package.json'));
const newman = require('newman');
const repo = new NotificationRepository(':memory:');
const secret = randomBytes(48).toString('base64url');
const local = new AccessService(repo.db, { secret: randomBytes(48).toString('base64url') });
const sign = (role, expiresIn = 300) => jwt.sign({ sub: 'usuario-lab', role }, secret, {
  algorithm: 'HS256', issuer: 'clientes-emisor-simulado', expiresIn });
const password = randomBytes(24).toString('base64url');
const access = new PlatformAccess(local, { settings: {}, async request(queue, body) {
  return body.usuario === 'admin-lab' && body.password === password
    ? { status: 200, data: { token: sign('administrador') } } : { status: 401 };
} }, { mode: 'clientes', secret, issuer: 'clientes-emisor-simulado' });
const server = createApp(repo, () => true, console, { access }).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
try {
  const environment = { values: Object.entries({ base_url: `http://127.0.0.1:${server.address().port}`,
    admin_username: 'admin-lab', admin_password: password, operator_token: sign('operador'),
    expired_token: sign('administrador', -10) }).map(([key, value]) => ({ key, value, enabled: true })) };
  const collection = JSON.parse(readFileSync('postman/Notificaciones-Seguridad.postman_collection.json', 'utf8'));
  const summary = await new Promise((resolve, reject) => newman.run({ collection, environment, reporters: [] },
    (error, result) => error ? reject(error) : resolve(result)));
  const evidence = { date: new Date().toISOString(), scope: 'API real de J con emisor F simulado; no certifica al servicio F ni RabbitMQ',
    requests: summary.run.stats.requests.total, assertions: summary.run.stats.assertions.total,
    failures: summary.run.failures.map(f => ({ test: f.error.test, message: f.error.message })),
    results: summary.run.executions.map(e => ({ name: e.item.name, status: e.response?.code })) };
  mkdirSync('.artifacts/evidencias', { recursive: true });
  writeFileSync('.artifacts/evidencias/postman.json', JSON.stringify(evidence, null, 2));
  console.log(`Postman: ${evidence.requests} solicitudes, ${evidence.assertions} comprobaciones, ${evidence.failures.length} fallos.`);
  if (evidence.failures.length) { console.log(JSON.stringify(evidence.failures)); process.exitCode = 1; }
} finally { await new Promise(resolve => server.close(resolve)); repo.close(); }
