import express from 'express';
import { fileURLToPath } from 'node:url';
import { notificationRoutes } from './routes/notificationRoutes.js';
import { accessRoutes, tokenFrom } from './routes/accessRoutes.js';
import { AccessError } from './services/accessService.js';
import { NotificationService } from './services/notificationService.js';
import { InvalidEventError } from './models/event.js';
export function createApp(repository, status = () => false, log = console, { access, emailEnabled = false, allowUnauthenticatedTests = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    if (req.headers.origin && !['GET', 'HEAD'].includes(req.method) && req.headers.origin !== `${req.protocol}://${req.get('host')}`) {
      return res.status(403).json({ error: 'Origen no permitido' });
    }
    next();
  });
  if (access) app.use('/api/auth', accessRoutes(access));
  if (allowUnauthenticatedTests) app.get('/api/auth/session', (req, res) => res.json({ role: 'admin', username: 'test' }));
  const authorize = options => (req, res, next) => {
    if (allowUnauthenticatedTests) return next();
    if (!access) return res.status(503).json({ error: 'Autenticación no configurada' });
    try { req.identity = access.authenticate(tokenFrom(req), options(req)); next(); } catch (error) { next(error); }
  };
  app.post('/api/eventos', authorize(req => ({ event: req.body?.evento || '__invalid__' })), (req, res, next) => {
    try {
      const result = new NotificationService(repository, emailEnabled).process(req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) { if (error instanceof InvalidEventError) return res.status(400).json({ error: error.message }); next(error); }
  });
  app.get('/health/live', (req, res) => res.json({ estado: 'activo' }));
  app.get('/health/ready', (req, res) => {
    const ready = status(); res.status(ready ? 200 : 503).json({ rabbitmq: ready ? 'conectado' : 'desconectado' });
  });
  app.use('/api/notificaciones', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  }, authorize(() => ({ admin: true })), notificationRoutes(repository));
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
  app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  app.use((error, req, res, next) => {
    if (error instanceof AccessError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Mensaje demasiado grande' });
    log.error('api_error'); res.status(500).json({ error: 'Error interno' });
  });
  return app;
}
