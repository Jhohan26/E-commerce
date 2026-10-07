import { Router } from 'express';
import { createController } from '../controllers/notificationController.js';
export function notificationRoutes(repository) {
  const router = Router(), controller = createController(repository);
  router.get('/', controller.list);
  router.get('/cliente/:clienteId', controller.client);
  router.get('/:id', controller.get);
  router.patch('/:id/leida', controller.read);
  return router;
}
