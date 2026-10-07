const templates = {
  PedidoCreado: ['Pedido recibido', id => `Tu pedido #${id} ha sido recibido correctamente.`],
  PagoAprobado: ['Pago aprobado', id => `El pago de tu pedido #${id} fue aprobado correctamente.`],
  PagoRechazado: ['Pago rechazado', id => `No fue posible aprobar el pago de tu pedido #${id}.`],
  FacturaGenerada: ['Factura generada', id => `La factura de tu pedido #${id} ha sido generada.`],
  InventarioInsuficiente: ['Inventario insuficiente', id => `No existe inventario suficiente para completar tu pedido #${id}.`]
};
export function generateMessage(event) {
  const [titulo, message] = templates[event.evento];
  return { titulo, mensaje: message(event.pedidoId) };
}
