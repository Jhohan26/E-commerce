const express = require('express');
const controller = require('../controllers/pedidosController');

const router = express.Router();

router.post('/', controller.crearPedido);
router.get('/', controller.listarPedidos);
router.get('/:id', controller.obtenerPedidoPorId);
router.put('/:id/estado', controller.cambiarEstado);
router.post('/:id/reenviar-evento', controller.reenviarEventoRabbitMQ);

module.exports = router;
