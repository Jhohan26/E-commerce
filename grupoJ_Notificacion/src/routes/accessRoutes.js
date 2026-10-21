import { Router } from 'express';
export function tokenFrom(req) {
  if (req.headers.authorization) return /^Bearer ([^\s]+)$/i.exec(req.headers.authorization)?.[1] || '';
  return /(?:^|;\s*)notificaciones_session=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';
}
export function accessRoutes(access) {
  const router = Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const login = module => async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || username.length > 64 || typeof password !== 'string' || password.length > 256) {
        return res.status(400).json({ error: 'Usuario y contraseña obligatorios' });
      }
      const result = await (module ? access.loginModule(username, password, req.ip) : access.login(username, password, req.ip));
      if (result.role === 'admin') res.cookie('notificaciones_session', result.token, {
        httpOnly: true, sameSite: 'strict', secure: access.secureCookie, path: '/',
        maxAge: access.lifetimeSeconds * 1000 });
      res.json({ access_token: result.token, token_type: 'Bearer', expiresAt: result.expiresAt,
        expires_in: Math.max(0, Math.floor((Date.parse(result.expiresAt) - Date.now()) / 1000)),
        inactivitySeconds: result.idleSeconds, role: result.platformRole || result.role });
    } catch (error) { next(error); }
  };
  router.post('/login', login(false));
  if (access.loginModule) router.post('/module-login', login(true));
  router.get('/session', (req, res, next) => {
    try { res.json(access.authenticate(tokenFrom(req), { admin: true, touch: false })); } catch (e) { next(e); }
  });
  router.post('/logout', (req, res, next) => {
    try {
      const session = access.authenticate(tokenFrom(req), { touch: false }); access.revoke(session.sessionId);
      res.clearCookie('notificaciones_session', { path: '/', httpOnly: true, sameSite: 'strict', secure: access.secureCookie });
      res.json({ estado: 'sesión cerrada' });
    } catch (e) { next(e); }
  });
  return router;
}
