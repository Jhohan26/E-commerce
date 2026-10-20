const express = require('express');
const controller = require('../controllers/pedidosController');
const { authenticateJwt, requireRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

// Todas las rutas de pedidos requieren un token Bearer JWT válido
router.use(authenticateJwt);

// Creación y consulta: permitido para cliente (sus propios pedidos), operador y administrador
router.post('/', requireRoles('cliente', 'operador', 'administrador'), controller.crearPedido);
router.get('/mios', requireRoles('cliente', 'operador', 'administrador'), controller.listarMisPedidos);
router.get('/', requireRoles('cliente', 'operador', 'administrador'), controller.listarPedidos);
router.get('/:id', requireRoles('cliente', 'operador', 'administrador'), controller.obtenerPedidoPorId);

// Operaciones operativas y administrativas: solo operador y administrador (cliente recibe 403)
router.put('/:id/estado', requireRoles('operador', 'administrador'), controller.cambiarEstado);
router.post('/:id/reenviar-evento', requireRoles('operador', 'administrador'), controller.reenviarEventoRabbitMQ);

module.exports = router;

