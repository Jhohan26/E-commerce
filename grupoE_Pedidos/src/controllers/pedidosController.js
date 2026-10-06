// Controlador HTTP para pedidos
const service = require('../services/pedidosService');
const { asyncHandler } = require('../middlewares/asyncHandler');

const crearPedido = asyncHandler(async (req, res) => {
  const { pedido, rabbit } = await service.crearPedido(req.body);

  res.status(201).json({
    mensaje: 'Pedido creado exitosamente y registrado en la base de datos.',
    pedido,
    rabbitmq: {
      publicado: rabbit.success,
      detalle: rabbit.success
        ? 'Evento PedidoCreado enviado exitosamente al Exchange de RabbitMQ.'
        : `Error al publicar en RabbitMQ: ${rabbit.error}`
    }
  });
});

const listarPedidos = asyncHandler(async (req, res) => {
  res.json(await service.listarPedidos());
});

const obtenerPedidoPorId = asyncHandler(async (req, res) => {
  res.json({ pedido: await service.obtenerPedido(req.params.id) });
});

const cambiarEstado = asyncHandler(async (req, res) => {
  const { pedidoId, nuevoEstado } = await service.cambiarEstado(req.params.id, req.body?.estado);

  res.json({
    mensaje: `Estado del pedido #${pedidoId} actualizado a "${nuevoEstado}".`,
    pedidoId,
    nuevoEstado
  });
});

const reenviarEventoRabbitMQ = asyncHandler(async (req, res) => {
  const { pedidoId, resultado } = await service.reenviarEvento(req.params.id);

  res.json({
    mensaje: `Evento PedidoCreado para el pedido #${pedidoId} reenviado a RabbitMQ.`,
    resultado
  });
});

module.exports = {
  crearPedido,
  listarPedidos,
  obtenerPedidoPorId,
  cambiarEstado,
  reenviarEventoRabbitMQ
};
