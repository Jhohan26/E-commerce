import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import amqp from 'amqplib';

const context = process.argv[2];
if (!context) throw new Error('Uso: node --env-file=.env.integracion scripts/verify-k8s.js <contexto-laboratorio>');
const args = ['--context', context, '-n', 'ecommerce'];
const run = (...rest) => execFileSync(process.env.KUBECTL_BINARY || 'kubectl', [...args, ...rest], {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
const resources = () => JSON.parse(run('get', 'pods', '-l', 'app=notificaciones', '-o', 'json')).items;
const pod = resources().find(p => p.status.phase === 'Running');
if (!pod) throw new Error('No hay Pod Running de Notificaciones');
const call = (name, code) => run('exec', name, '--', 'node', '--input-type=module', '-e', code);
const settings = JSON.parse(call(pod.metadata.name, 'console.log(JSON.stringify({queue:process.env.RABBITMQ_QUEUE,mode:process.env.USER_AUTH_MODE,email:process.env.EMAIL_ENABLED}))'));
if (settings.queue !== 'grupo-j.notificaciones.laboratorio' || settings.mode !== 'local' || settings.email !== 'false') {
  throw new Error('La prueba destructiva solo admite el perfil aislado k8s/lab; no modifica el despliegue compartido.');
}
const checkApi = name => JSON.parse(call(name, `console.log(JSON.stringify({
  live:(await fetch('http://notificaciones:3000/health/live')).status,
  ready:(await fetch('http://notificaciones:3000/health/ready')).status,
  protected:(await fetch('http://notificaciones:3000/api/notificaciones')).status}));`));
const before = checkApi(pod.metadata.name);
if (before.live !== 200 || before.ready !== 200 || before.protected !== 401) throw new Error('API no preparada');
const pedidoId = Date.now();
const event = { evento: 'PagoAprobado', clienteId: 1, pedidoId, fecha: new Date().toISOString() };
const connection = await amqp.connect(process.env.RABBITMQ_URL, { timeout: 5000, rejectUnauthorized: true });
connection.on('error', () => {});
try {
  const channel = await connection.createConfirmChannel();
  channel.publish('grupo-j.laboratorio.eventos', event.evento, Buffer.from(JSON.stringify(event)), { persistent: true });
  await channel.waitForConfirms();
} finally { await connection.close().catch(() => {}); }
const waitUntil = async condition => {
  const until = Date.now() + 180000;
  while (Date.now() < until) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 1500)); }
  throw new Error('Tiempo de espera agotado en recuperación');
};
const row = name => JSON.parse(call(name, `import {NotificationRepository} from './src/repositories/notificationRepository.js';
  const r=new NotificationRepository(process.env.DATABASE_PATH);
  console.log(JSON.stringify(r.db.prepare('SELECT id,leida FROM Notificacion WHERE Pedido_id=?').get(${pedidoId})||null));r.close();`));
await waitUntil(() => row(pod.metadata.name));
const saved = row(pod.metadata.name);
const password = randomBytes(24).toString('base64url');
const setup = `import {NotificationRepository} from './src/repositories/notificationRepository.js';
  import {AccessService} from './src/services/accessService.js';
  const r=new NotificationRepository(process.env.DATABASE_PATH);
  const a=new AccessService(r.db,{secret:process.env.JWT_SECRET});
  await a.provision('admin-laboratorio',${JSON.stringify(password)},'admin');r.close();`;
call(pod.metadata.name, setup);
const authenticated = name => JSON.parse(call(name, `const l=await fetch('http://notificaciones:3000/api/auth/login',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin-laboratorio',password:${JSON.stringify(password)}})});
  const b=await l.json();const q=await fetch('http://notificaciones:3000/api/notificaciones/${saved.id}',{
    headers:{Authorization:'Bearer '+b.access_token}});console.log(JSON.stringify({login:l.status,query:q.status,id:(await q.json()).id}));`));
const authBefore = authenticated(pod.metadata.name);
if (authBefore.login !== 200 || authBefore.query !== 200) throw new Error('Fallo de acceso autorizado');
run('delete', 'pod', pod.metadata.name, '--wait=false');
let replacement;
await waitUntil(() => {
  replacement = resources().find(p => p.metadata.uid !== pod.metadata.uid && !p.metadata.deletionTimestamp &&
    p.status.conditions?.some(c => c.type === 'Ready' && c.status === 'True'));
  return Boolean(replacement);
});
const after = checkApi(replacement.metadata.name);
const restored = row(replacement.metadata.name);
const authAfter = authenticated(replacement.metadata.name);
if (after.ready !== 200 || restored?.id !== saved.id || authAfter.query !== 200) throw new Error('La recuperación no conservó datos o acceso');
const evidence = { date: new Date().toISOString(), context, namespace: 'ecommerce',
  scope: 'Kubernetes real, Service DNS, RabbitMQ real aislado, SQLite PVC; autenticación local de laboratorio, no F real',
  oldPod: pod.metadata.name, oldUid: pod.metadata.uid, newPod: replacement.metadata.name, newUid: replacement.metadata.uid,
  before, after, authBefore, authAfter, notificationPersisted: restored.id === saved.id };
mkdirSync('.artifacts/evidencias', { recursive: true });
writeFileSync('.artifacts/evidencias/kubernetes.json', JSON.stringify(evidence, null, 2));
console.log('Kubernetes: Service accesible, API protegida, evento recibido y Pod reemplazado conservando notificación y cuenta.');
