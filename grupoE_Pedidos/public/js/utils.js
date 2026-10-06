// Utilidades de formato y catálogo de estados.

export const ESTADOS = [
  { value: 'PENDIENTE',  label: 'Pendiente',  tone: 'pendiente'  },
  { value: 'EN_PROCESO', label: 'En proceso', tone: 'proceso'    },
  { value: 'PAGADO',     label: 'Pagado',     tone: 'pagado'     },
  { value: 'ENVIADO',    label: 'Enviado',    tone: 'enviado'    },
  { value: 'COMPLETADO', label: 'Completado', tone: 'completado' },
  { value: 'CANCELADO',  label: 'Cancelado',  tone: 'cancelado'  }
];

const ESTADO_MAP = Object.fromEntries(ESTADOS.map(e => [e.value, e]));

export function estadoMeta(value) {
  return ESTADO_MAP[value] || { value, label: value, tone: 'completado' };
}

// Escapa texto antes de insertarlo con innerHTML.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const moneyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
});

export function formatMoney(amount) {
  return moneyFormatter.format(Number(amount) || 0);
}

export function formatNumber(n) {
  return new Intl.NumberFormat('es-CO').format(Number(n) || 0);
}

// Devuelve { date: '06 oct 2026', time: '03:35' } a partir de un ISO local.
export function formatDateParts(iso) {
  if (!iso) return { date: '-', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: String(iso), time: '' };
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleDateString('es-CO', { month: 'short' }).replace(/\./g, '');
  return {
    date: `${day} ${month} ${d.getFullYear()}`,
    time: d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
  };
}

export function formatDateTime(iso) {
  const { date, time } = formatDateParts(iso);
  return time ? `${date}, ${time}` : date;
}

export function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function statusChipHtml(value) {
  const meta = estadoMeta(value);
  return `<span class="chip chip-${meta.tone}"><span class="chip-dot" aria-hidden="true"></span>${escapeHtml(meta.label)}</span>`;
}

// Catálogo local de referencia (Clientes y Productos)
export const CLIENTES_CATALOGO = {
  25: { id: 25, nombre: 'Carlos Gómez', ciudad: 'Bogotá' },
  30: { id: 30, nombre: 'María Rodríguez', ciudad: 'Medellín' },
  1:  { id: 1,  nombre: 'Empresas Unidas S.A.S.', ciudad: 'Cali' },
  10: { id: 10, nombre: 'Ana Martínez', ciudad: 'Barranquilla' }
};

export const PRODUCTOS_CATALOGO = {
  15: { id: 15, nombre: 'Portátil Gamer 15" Core i7', precio: 2500000, icono: 'laptop' },
  10: { id: 10, nombre: 'Mouse inalámbrico Logitech', precio: 1200000, icono: 'mouse' },
  12: { id: 12, nombre: 'Teclado mecánico RGB',       precio: 1200000, icono: 'keyboard' },
  5:  { id: 5,  nombre: 'Monitor curvo 27" Full HD',  precio: 850000,  icono: 'monitor' },
  8:  { id: 8,  nombre: 'Auriculares Bluetooth Pro',  precio: 350000,  icono: 'headphones' }
};

export function getClienteInfo(id) {
  return CLIENTES_CATALOGO[Number(id)] || null;
}

export function getClienteNombre(id) {
  const c = CLIENTES_CATALOGO[Number(id)];
  return c ? c.nombre : `Cliente #${id}`;
}

export function getProductoInfo(id) {
  return PRODUCTOS_CATALOGO[Number(id)] || null;
}

export function getProductoNombre(id) {
  const p = PRODUCTOS_CATALOGO[Number(id)];
  return p ? p.nombre : `Producto #${id}`;
}

export function getProductoIcono(id) {
  const p = PRODUCTOS_CATALOGO[Number(id)];
  return `p-${p ? p.icono : 'box'}`;
}

// "Carlos Gómez" -> "CG"
export function iniciales(nombre) {
  return String(nombre || '')
    .split(/\s+/)
    .filter((w) => /^[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '#';
}

