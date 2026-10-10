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

// Catálogo dinámico de Clientes (obtenido exclusivamente del Grupo F)
export let CLIENTES_CATALOGO = {};

export function actualizarClientesCatalogo(lista) {
  CLIENTES_CATALOGO = {};
  if (Array.isArray(lista) && lista.length > 0) {
    lista.forEach((c) => {
      CLIENTES_CATALOGO[Number(c.id)] = {
        id: Number(c.id),
        nombre: c.nombre,
        ciudad: c.ciudad || '',
        correo: c.correo || '',
        estado: c.estado,
        activo: c.activo !== false,
        origen: c.origen || 'grupoF'
      };
    });
  }
}

export const PRODUCTOS_CATALOGO = {
  // Catálogo sincronizado con Carro (Grupo D)
  1:  { id: 1,  nombre: 'Portátil 14" Ryzen 5',       precio: 2500000, icono: 'laptop' },
  2:  { id: 2,  nombre: 'Mouse inalámbrico',          precio: 65000,   icono: 'mouse' },
  3:  { id: 3,  nombre: 'Teclado mecánico',           precio: 220000,  icono: 'keyboard' },
  4:  { id: 4,  nombre: 'Monitor 24" Full HD',        precio: 680000,  icono: 'monitor' },
  5:  { id: 5,  nombre: 'Audífonos Bluetooth',        precio: 150000,  icono: 'headphones' },
  6:  { id: 6,  nombre: 'Disco SSD 1 TB',             precio: 310000,  icono: 'box' },

  // Referencias adicionales
  15: { id: 15, nombre: 'Portátil Gamer 15" Core i7', precio: 2500000, icono: 'laptop' },
  10: { id: 10, nombre: 'Mouse inalámbrico Logitech', precio: 1200000, icono: 'mouse' },
  12: { id: 12, nombre: 'Teclado mecánico RGB',       precio: 1200000, icono: 'keyboard' },
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

