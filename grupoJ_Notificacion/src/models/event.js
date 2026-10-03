export const eventTypes = ['PedidoCreado', 'PagoAprobado', 'PagoRechazado', 'FacturaGenerada', 'InventarioInsuficiente'];
export class InvalidEventError extends Error {}
const invalid = text => { throw new InvalidEventError(text); };
const id = value => Number.isSafeInteger(value) && value > 0;
export function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) invalid('El mensaje debe ser un objeto JSON');
  if (!eventTypes.includes(event.evento)) invalid('Evento no admitido');
  if (!id(event.pedidoId) || !id(event.clienteId)) invalid('pedidoId y clienteId deben ser enteros positivos');
  // Los otros cuatro contratos no aparecen definidos en Semana8.
  // Este adaptador mínimo es un supuesto sugerido que debe acordarse antes de integrar.
  if (typeof event.fecha !== 'string' || !validDate(event.fecha)) invalid('fecha debe ser una fecha ISO válida');
  if (event.evento === 'PedidoCreado') {
    if (!Number.isFinite(event.total) || event.total < 0) invalid('total debe ser un número no negativo');
    if (!Array.isArray(event.productos) || !event.productos.length) invalid('productos debe contener al menos un producto');
    for (const p of event.productos) {
      if (!p || !id(p.productoId) || !id(p.cantidad) || !Number.isFinite(p.precio) || p.precio < 0) invalid('Producto inválido');
    }
  }
  return event;
}
function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, y, m, d, h, min, sec] = match.map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return m >= 1 && m <= 12 && d >= 1 && d <= days && h < 24 && min < 60 && sec < 60;
}
