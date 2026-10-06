// Lógica de negocio y validaciones del módulo de Pedidos
const repo = require('../repositories/pedidosRepository');
const { publicarPedidoCreado } = require('../events/publisher');
const { ahoraLocal } = require('../utils/fecha');
const { HttpError } = require('../utils/httpError');

const ESTADOS_VALIDOS = ['PENDIENTE', 'EN_PROCESO', 'PAGADO', 'ENVIADO', 'CANCELADO', 'COMPLETADO'];

/* ---------- Validaciones ---------- */

function validarClienteId(valor) {
  const clienteId = Number(valor);
  if (!Number.isInteger(clienteId) || clienteId < 1) {
    throw new HttpError(400, 'El campo clienteId es obligatorio y debe ser un número entero positivo.');
  }
  return clienteId;
}

function validarProductos(productos) {
  if (!Array.isArray(productos) || productos.length === 0) {
    throw new HttpError(400, 'Debe incluir al menos un producto en el pedido.');
  }

  return productos.map((item) => {
    const productoId = Number(item?.productoId);
    const cantidad = Number(item?.cantidad);
    const precio = Number(item?.precio);

    const valido =
      Number.isInteger(productoId) && productoId > 0 &&
      Number.isInteger(cantidad) && cantidad > 0 &&
      Number.isFinite(precio) && precio >= 0;

    if (!valido) {
      throw new HttpError(
        400,
        `Datos inválidos en el producto: ${JSON.stringify(item)}. El producto y la cantidad deben ser enteros positivos y el precio no puede ser negativo.`
      );
    }

    return { productoId, cantidad, precio, subtotal: cantidad * precio };
  });
}

function validarId(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id < 1) {
    throw new HttpError(400, 'El id del pedido debe ser un número entero positivo.');
  }
  return id;
}

/* ---------- Casos de uso ---------- */

// Crea el pedido en MySQL y publica el evento PedidoCreado a RabbitMQ
async function crearPedido({ clienteId, productos } = {}) {
  const cliente = validarClienteId(clienteId);
  const items = validarProductos(productos);
  const total = items.reduce((acc, i) => acc + i.subtotal, 0);
  const fecha = ahoraLocal();

  const pedidoId = await repo.crearConItems({
    clienteId: cliente,
    fechaMySQL: fecha.mysql,
    total,
    items
  });

  // Si RabbitMQ falla, el pedido ya quedó guardado: se informa y se puede reenviar el evento.
  const rabbit = await publicarPedidoCreado({
    pedidoId,
    clienteId: cliente,
    fecha: fecha.iso,
    total,
    productos: items
  });

  return {
    pedido: {
      id: pedidoId,
      clienteId: cliente,
      fecha: fecha.iso,
      total,
      estado: 'PENDIENTE',
      productos: items
    },
    rabbit
  };
}

async function listarPedidos() {
  const pedidos = await repo.listar();
  return { total: pedidos.length, pedidos };
}

async function obtenerPedido(idParam) {
  const id = validarId(idParam);
  const pedido = await repo.buscarPorId(id);
  if (!pedido) throw new HttpError(404, `El pedido #${id} no existe.`);

  const productos = await repo.itemsDePedido(id);
  return { ...pedido, productos };
}

async function cambiarEstado(idParam, estado) {
  const id = validarId(idParam);
  const nuevoEstado = String(estado ?? '').toUpperCase().trim();

  if (!ESTADOS_VALIDOS.includes(nuevoEstado)) {
    throw new HttpError(400, `Estado inválido. Los permitidos son: ${ESTADOS_VALIDOS.join(', ')}`);
  }

  const existe = await repo.actualizarEstado(id, nuevoEstado);
  if (!existe) throw new HttpError(404, `El pedido #${id} no fue encontrado.`);

  return { pedidoId: id, nuevoEstado };
}

// Reenvía el evento PedidoCreado de un pedido existente a RabbitMQ
async function reenviarEvento(idParam) {
  const pedido = await obtenerPedido(idParam);

  const resultado = await publicarPedidoCreado({
    pedidoId: pedido.id,
    clienteId: pedido.clienteId,
    fecha: pedido.fecha,
    total: pedido.total,
    productos: pedido.productos
  });

  return { pedidoId: pedido.id, resultado };
}

module.exports = {
  ESTADOS_VALIDOS,
  crearPedido,
  listarPedidos,
  obtenerPedido,
  cambiarEstado,
  reenviarEvento
};
