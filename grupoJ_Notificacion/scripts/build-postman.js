import { mkdirSync, writeFileSync } from 'node:fs';

const test = (code, extra = []) => [{ listen: 'test', script: { type: 'text/javascript', exec: [
  `pm.test('HTTP ${code}', () => pm.response.to.have.status(${code}));`, ...extra
] } }];
const get = (name, path, code, token) => ({ name, request: {
  method: 'GET', auth: { type: 'noauth' }, header: token ? [{ key: 'Authorization', value: `Bearer {{${token}}}` }] : [],
  url: `{{base_url}}${path}` }, event: test(code) });
const login = (name, username, password, code, extra) => ({ name, request: {
  method: 'POST', auth: { type: 'noauth' }, header: [{ key: 'Content-Type', value: 'application/json' }],
  url: '{{base_url}}/api/auth/login', body: { mode: 'raw', raw: JSON.stringify({ username, password }), options: { raw: { language: 'json' } } }
}, event: test(code, extra) });
const collection = { info: { name: 'Grupo J - Seguridad JWT del laboratorio',
  schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  description: 'APIs administrativas de Notificaciones. En modo clientes el login se delega a F. No genera tokens de producción ni publica eventos.' },
variable: ['base_url', 'admin_username', 'admin_password', 'operator_token', 'expired_token'].map(key => ({ key,
  value: key === 'base_url' ? 'http://localhost:3010' : '' })),
item: [
  get('01 Público sin token', '/health/live', 200),
  get('02 Protegido sin token', '/api/notificaciones', 401),
  login('03 Login correcto', '{{admin_username}}', '{{admin_password}}', 200, [
    "const body = pm.response.json(); pm.expect(body.access_token).to.be.a('string');",
    "pm.collectionVariables.set('admin_token', body.access_token);",
    "const parts = body.access_token.split('.'); parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);",
    "pm.collectionVariables.set('tampered_token', parts.join('.'));"
  ]),
  get('04 Protegido con token válido', '/api/notificaciones', 200, 'admin_token'),
  get('05 Token alterado', '/api/notificaciones', 401, 'tampered_token'),
  get('06 Token vencido', '/api/notificaciones', 401, 'expired_token'),
  get('07 Rol no autorizado', '/api/notificaciones', 403, 'operator_token'),
  get('08 Rol administrador autorizado', '/api/notificaciones', 200, 'admin_token'),
  login('09 Contraseña incorrecta', '{{admin_username}}', 'contrasena-incorrecta-de-prueba', 401),
  login('10 Usuario inexistente', 'usuario-inexistente-laboratorio', 'contrasena-incorrecta-de-prueba', 401)
] };
mkdirSync('postman', { recursive: true });
writeFileSync('postman/Notificaciones-Seguridad.postman_collection.json', JSON.stringify(collection, null, 2) + '\n');
writeFileSync('postman/Local.postman_environment.json', JSON.stringify({ name: 'Notificaciones local - completar en privado',
  values: collection.variable.map(v => ({ ...v, enabled: true, type: v.key.includes('password') || v.key.includes('token') ? 'secret' : 'default' })),
  _postman_variable_scope: 'environment' }, null, 2) + '\n');
console.log('Colección y plantilla Postman generadas sin credenciales.');
