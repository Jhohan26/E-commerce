import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { AccessError } from './accessService.js';

export class PlatformAccess {
  constructor(local, rpc, settings, clock = () => Date.now()) {
    Object.assign(this, { local, rpc, settings, clock, db: local.db,
      secureCookie: local.secureCookie, lifetimeSeconds: local.lifetimeSeconds });
    this.db.exec(`CREATE TABLE IF NOT EXISTS PlatformSession (
      id TEXT PRIMARY KEY, subject TEXT NOT NULL, lastActivity INTEGER NOT NULL,
      expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)`);
  }
  verify(token) {
    let payload;
    try {
      if (typeof token !== 'string' || token.length > 16384) throw new Error();
      payload = jwt.verify(token, this.settings.secret, { algorithms: ['HS256'],
        issuer: this.settings.issuer, ...(this.settings.audience ? { audience: this.settings.audience } : {}),
        clockTimestamp: Math.floor(this.clock() / 1000) });
      if (typeof payload.sub !== 'string' || !payload.sub.length || payload.sub.length > 256 ||
          !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) ||
          payload.iat > Math.floor(this.clock() / 1000) || payload.exp <= payload.iat ||
          (payload.role && payload.rol && payload.role !== payload.rol)) throw new Error();
    } catch { throw new AccessError(); }
    const role = payload.role ?? payload.rol;
    if (!['cliente', 'operador', 'administrador'].includes(role)) throw new AccessError('El token no contiene un rol admitido');
    return { payload, role };
  }
  async login(username, password, address) {
    if (this.settings.mode === 'local') return this.local.login(username, password, address);
    this.local.limitLogin(username, address);
    let response;
    try { response = await this.rpc.request(this.rpc.settings.loginQueue || 'auth.login', { usuario: username, password }); }
    catch { throw new AccessError('Autenticación de Clientes no disponible', 503); }
    if (response?.status === 401) throw new AccessError('Credenciales incorrectas');
    if (response?.status !== 200) throw new AccessError('Autenticación de Clientes no disponible', 503);
    const token = response.data?.token;
    const { payload, role } = this.verify(token);
    const identity = this.authenticate(token);
    return { token, role: identity.role, expiresAt: new Date(payload.exp * 1000).toISOString(),
      idleSeconds: this.local.idleSeconds, platformRole: role };
  }
  async loginModule(username, password, address) {
    return this.local.login(username, password, address, { moduleOnly: true });
  }
  authenticate(token, options = {}) {
    if (options.event || this.settings.mode === 'local') return this.local.authenticate(token, options);
    const { payload, role } = this.verify(token);
    const now = this.clock();
    const id = createHash('sha256').update(token).digest('hex');
    const previous = this.db.prepare('SELECT * FROM PlatformSession WHERE id=?').get(id);
    const expires = Math.min(payload.exp * 1000, previous?.expires ?? now + this.local.lifetimeSeconds * 1000);
    if (previous?.revoked || expires <= now || (previous && previous.lastActivity + this.local.idleSeconds * 1000 <= now)) {
      throw new AccessError();
    }
    if (options.admin && role !== 'administrador') throw new AccessError('El rol no tiene permiso para esta operación', 403);
    if (!previous) this.db.prepare('INSERT INTO PlatformSession(id,subject,lastActivity,expires) VALUES (?,?,?,?)')
      .run(id, payload.sub, now, expires);
    else if (options.touch !== false) this.db.prepare('UPDATE PlatformSession SET lastActivity=? WHERE id=?').run(now, id);
    return { username: payload.sub, role: role === 'administrador' ? 'admin' : role, platformRole: role,
      sessionId: `platform:${id}` };
  }
  revoke(id) {
    if (id.startsWith('platform:')) this.db.prepare('UPDATE PlatformSession SET revoked=1 WHERE id=?').run(id.slice(9));
    else this.local.revoke(id);
  }
}
