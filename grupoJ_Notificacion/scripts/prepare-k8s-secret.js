import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv.includes('--local-lab') ? 'local' : 'clientes';
const data = {};
for (const name of ['JWT_SECRET', 'RABBITMQ_URL', 'CLIENTES_RABBITMQ_URL', 'CLIENTES_RPC_USERNAME',
  'CLIENTES_RPC_PASSWORD', 'CLIENTES_JWT_SECRET', 'CLIENTES_JWT_ISSUER', 'CLIENTES_JWT_AUDIENCE',
  'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) {
  if (process.env[name]) data[name] = process.env[name];
}
if (!data.JWT_SECRET) data.JWT_SECRET = randomBytes(48).toString('base64url');
if (!data.RABBITMQ_URL?.startsWith('amqps://')) throw new Error('Configura RABBITMQ_URL con AMQPS en el entorno privado');
if (mode === 'clientes' && (!data.CLIENTES_JWT_ISSUER || Buffer.byteLength(data.CLIENTES_JWT_SECRET || '') < 32)) {
  throw new Error('Falta el contrato de F: CLIENTES_JWT_ISSUER y CLIENTES_JWT_SECRET. No se generará un emisor ficticio.');
}
mkdirSync('.artifacts/k8s', { recursive: true });
const path = resolve('.artifacts/k8s/notificaciones-secret.json');
writeFileSync(path, JSON.stringify({ apiVersion: 'v1', kind: 'Secret',
  metadata: { name: 'notificaciones-secret', namespace: 'ecommerce' }, type: 'Opaque', stringData: data }), { mode: 0o600 });
console.log('Secret preparado en .artifacts/k8s/notificaciones-secret.json; no subirlo a Git.');
