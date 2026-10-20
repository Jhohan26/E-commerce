// Controlador HTTP para pedidos (protegido con JWT y control de acceso por rol)
const service = require('../services/pedidosService');
const { asyncHandler } = require('../middlewares/asyncHandler');

const crearPedido = asyncHandler(async (req, res) => {
  const body = { ...(req.body || {}) };

  // Si el usuario tiene rol "cliente", solo puede crear pedidos para su propio clienteId
  if (req.user && req.user.role === 'cliente' && req.user.clienteId) {
    if (
      body.clienteId !== undefined &&
      body.clienteId !== null &&
      body.clienteId !== '' &&
      Number(body.clienteId) !== Number(req.user.clienteId)
    ) {
      return res.status(403).json({
        error: `Acceso denegado: tu sesión de cliente (#${req.user.clienteId}) no puede crear pedidos a nombre del cliente #${body.clienteId}.`
      });
    }
    body.clienteId = req.user.clienteId;
  }

  const { pedido, rabbit } = await service.crearPedido(body);

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
  const resultado = await service.listarPedidos();

  // Si el rol es "cliente", únicamente puede ver sus propios pedidos
  if (req.user && req.user.role === 'cliente' && req.user.clienteId) {
    if (
      req.query.clienteId !== undefined &&
      Number(req.query.clienteId) !== Number(req.user.clienteId)
    ) {
      return res.status(403).json({
        error: `Acceso denegado: no tienes permisos para consultar los pedidos del cliente #${req.query.clienteId}.`
      });
    }

    const misPedidos = (resultado.pedidos || []).filter(
      (p) => Number(p.clienteId) === Number(req.user.clienteId)
    );
    return res.json({
      total: misPedidos.length,
      filtradoPorClienteId: req.user.clienteId,
      pedidos: misPedidos
    });
  }

  // Operador o administrador: opcionalmente puede filtrar por ?clienteId=
  if (req.query.clienteId !== undefined && req.query.clienteId !== '') {
    const filtroId = Number(req.query.clienteId);
    const filtrados = (resultado.pedidos || []).filter((p) => Number(p.clienteId) === filtroId);
    return res.json({
      total: filtrados.length,
      filtradoPorClienteId: filtroId,
      pedidos: filtrados
    });
  }

  res.json(resultado);
});

const listarMisPedidos = asyncHandler(async (req, res) => {
  const resultado = await service.listarPedidos();
  const targetClienteId = req.user?.clienteId || Number(req.query.clienteId) || null;

  if (!targetClienteId) {
    return res.json(resultado);
  }

  const misPedidos = (resultado.pedidos || []).filter(
    (p) => Number(p.clienteId) === Number(targetClienteId)
  );
  res.json({
    total: misPedidos.length,
    clienteId: targetClienteId,
    pedidos: misPedidos
  });
});

const obtenerPedidoPorId = asyncHandler(async (req, res) => {
  const pedido = await service.obtenerPedido(req.params.id);

  if (
    req.user &&
    req.user.role === 'cliente' &&
    req.user.clienteId &&
    Number(pedido.clienteId) !== Number(req.user.clienteId)
  ) {
    return res.status(403).json({
      error: `Acceso denegado: el pedido #${pedido.id} pertenece a otro cliente.`
    });
  }

  res.json({ pedido });
});

const cambiarEstado = asyncHandler(async (req, res) => {
  const { pedidoId, nuevoEstado, motivoCancelacion } = await service.cambiarEstado(
    req.params.id,
    req.body?.estado,
    req.body?.motivo
  );

  res.json({
    mensaje: `Estado del pedido #${pedidoId} actualizado a "${nuevoEstado}".`,
    pedidoId,
    nuevoEstado,
    motivoCancelacion
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
  listarMisPedidos,
  obtenerPedidoPorId,
  cambiarEstado,
  reenviarEventoRabbitMQ
};

