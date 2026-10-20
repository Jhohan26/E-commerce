import express from 'express';
import { fileURLToPath } from 'node:url';
import { notificationRoutes } from './routes/notificationRoutes.js';
export function createApp(repository, status = () => false, log = console) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health/live', (req, res) => res.json({ estado: 'activo' }));
  app.get('/health/ready', (req, res) => {
    const ready = status(); res.status(ready ? 200 : 503).json({ rabbitmq: ready ? 'conectado' : 'desconectado' });
  });
  app.use('/api/notificaciones', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  }, notificationRoutes(repository));
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
  app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  app.use((error, req, res, next) => { log.error('api_error'); res.status(500).json({ error: 'Error interno' }); });
  return app;
}
