import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const issuer = 'grupo-j.notificaciones';
const audience = 'notificaciones';
export const moduleEvents = {
  pedidos: ['PedidoCreado'], pagos: ['PagoAprobado', 'PagoRechazado'],
  inventario: ['InventarioInsuficiente'], facturacion: ['FacturaGenerada']
};
export class AccessError extends Error {
  constructor(message = 'Sesión inválida o vencida', status = 401) { super(message); this.status = status; }
}
export class AccessService {
  constructor(db, { secret, idleSeconds = 1800, lifetimeSeconds = 28800, secureCookie = false }, clock = () => Date.now()) {
    if (!secret || Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET debe tener al menos 32 bytes');
    Object.assign(this, { db, secret, idleSeconds, lifetimeSeconds, secureCookie, clock });
    db.exec(`CREATE TABLE IF NOT EXISTS ModuleAccount (
      username TEXT PRIMARY KEY, salt TEXT NOT NULL, passwordHash TEXT NOT NULL,
      role TEXT NOT NULL, events TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS AccessSession (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, lastActivity INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_session_user ON AccessSession(username);
      CREATE TABLE IF NOT EXISTS LoginThrottle (key TEXT PRIMARY KEY, count INTEGER NOT NULL, untilTime INTEGER NOT NULL);`);
  }
  async provision(username, password, role, events = []) {
    if (!/^[a-z][a-z0-9_-]{2,40}$/.test(username) || typeof password !== 'string' || password.length < 16 ||
        !['admin', 'module'].includes(role) || !Array.isArray(events) ||
        events.some(e => !Object.values(moduleEvents).flat().includes(e))) throw new Error('Cuenta o permisos inválidos');
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)).toString('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO ModuleAccount(username,salt,passwordHash,role,events) VALUES (?,?,?,?,?)
        ON CONFLICT(username) DO UPDATE SET salt=excluded.salt,passwordHash=excluded.passwordHash,
        role=excluded.role,events=excluded.events,enabled=1`).run(username, salt, hash, role, JSON.stringify(events));
      this.db.prepare('DELETE FROM AccessSession WHERE username=?').run(username);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async login(username, password, address = 'local') {
    const now = this.clock();
    const keys = [`ip:${address}`, `user:${username}`];
    for (const key of keys) {
      const limit = this.db.prepare('SELECT * FROM LoginThrottle WHERE key=?').get(key);
      if (limit && limit.untilTime > now && limit.count >= 10) throw new AccessError('Demasiados intentos; intenta más tarde', 429);
      this.db.prepare(`INSERT INTO LoginThrottle VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET
        count=CASE WHEN untilTime<=? THEN 1 ELSE count+1 END,
        untilTime=CASE WHEN untilTime<=? THEN excluded.untilTime ELSE untilTime END`).run(key, now + 900000, now, now);
    }
    const account = this.db.prepare('SELECT * FROM ModuleAccount WHERE username=?').get(username);
    const candidate = await scrypt(password, account?.salt || 'invalid-account-salt', 64);
    const expected = account ? Buffer.from(account.passwordHash, 'hex') : Buffer.alloc(64);
    if (!account || !account.enabled || !timingSafeEqual(candidate, expected)) throw new AccessError('Credenciales incorrectas');
    this.db.prepare('DELETE FROM LoginThrottle WHERE key=?').run(`user:${username}`);
    this.db.prepare('DELETE FROM AccessSession WHERE expires<=? OR lastActivity<=?').run(now, now - this.idleSeconds * 1000);
    const id = randomUUID();
    const expires = now + this.lifetimeSeconds * 1000;
    this.db.prepare('INSERT INTO AccessSession VALUES (?,?,?,?)').run(id, username, now, expires);
    const token = jwt.sign({ sub: username, jti: id, iat: Math.floor(now / 1000) }, this.secret,
      { algorithm: 'HS256', issuer, audience, expiresIn: this.lifetimeSeconds });
    return { token, expiresAt: new Date(expires).toISOString(), idleSeconds: this.idleSeconds, role: account.role };
  }
  authenticate(token, { event, admin = false, touch = true } = {}) {
    let payload;
    try { payload = jwt.verify(token, this.secret, { algorithms: ['HS256'], issuer, audience,
      clockTimestamp: Math.floor(this.clock() / 1000) }); } catch { throw new AccessError(); }
    if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') throw new AccessError();
    const session = this.db.prepare(`SELECT s.*,a.role,a.events,a.enabled FROM AccessSession s
      JOIN ModuleAccount a ON a.username=s.username WHERE s.id=? AND s.username=?`).get(payload.jti, payload.sub);
    const now = this.clock();
    if (!session || !session.enabled || session.expires <= now || session.lastActivity + this.idleSeconds * 1000 <= now) {
      if (session) this.db.prepare('DELETE FROM AccessSession WHERE id=?').run(session.id);
      throw new AccessError();
    }
    if ((admin && session.role !== 'admin') || (event && (session.role !== 'module' || !JSON.parse(session.events).includes(event)))) {
      throw new AccessError('El módulo no tiene permiso para esta operación', 403);
    }
    if (touch) this.db.prepare('UPDATE AccessSession SET lastActivity=? WHERE id=?').run(now, session.id);
    return { username: session.username, role: session.role, sessionId: session.id };
  }
  revoke(sessionId) { this.db.prepare('DELETE FROM AccessSession WHERE id=?').run(sessionId); }
}
