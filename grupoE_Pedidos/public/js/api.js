// Capa de acceso a la API REST del microservicio de Pedidos (con soporte JWT).

const BASE = '/api/pedidos';
const STORAGE_TOKEN_KEY = 'pedidos_jwt_token';
const STORAGE_PROFILE_KEY = 'pedidos_jwt_profile';
const STORAGE_USER_KEY = 'pedidos_jwt_user';

let currentToken = sessionStorage.getItem(STORAGE_TOKEN_KEY) || '';
let currentProfile = sessionStorage.getItem(STORAGE_PROFILE_KEY) || 'administrador';
let currentUser = null;
try {
  currentUser = JSON.parse(sessionStorage.getItem(STORAGE_USER_KEY) || 'null');
} catch {
  currentUser = null;
}

export function getAuthSession() {
  return {
    token: currentToken,
    profile: currentProfile,
    user: currentUser
  };
}

export function setAuthSession({ token = '', profile = 'administrador', user = null } = {}) {
  currentToken = token || '';
  currentProfile = profile || 'administrador';
  currentUser = user || null;

  if (currentToken) sessionStorage.setItem(STORAGE_TOKEN_KEY, currentToken);
  else sessionStorage.removeItem(STORAGE_TOKEN_KEY);

  sessionStorage.setItem(STORAGE_PROFILE_KEY, currentProfile);

  if (currentUser) sessionStorage.setItem(STORAGE_USER_KEY, JSON.stringify(currentUser));
  else sessionStorage.removeItem(STORAGE_USER_KEY);
}

async function request(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (currentToken) {
    headers.Authorization = `Bearer ${currentToken}`;
  }

  const res = await fetch(url, {
    ...options,
    headers
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // La respuesta no era JSON.
  }

  if (!res.ok) {
    const error = new Error((data && data.error) || `Error ${res.status} del servidor`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  listar: () => request(BASE),
  mios: () => request(`${BASE}/mios`),
  obtener: (id) => request(`${BASE}/${id}`),
  crear: (body) => request(BASE, { method: 'POST', body: JSON.stringify(body) }),
  cambiarEstado: (id, estado, motivo = null) =>
    request(`${BASE}/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado, motivo }) }),
  reenviarEvento: (id) => request(`${BASE}/${id}/reenviar-evento`, { method: 'POST' }),

  // Emisión de token JWT por rol (cliente, operador, administrador)
  emitirToken: (payload) =>
    request('/api/auth/token', { method: 'POST', body: JSON.stringify(payload || {}) }),

  // Consulta de Clientes (Grupo F vía RabbitMQ RPC)
  clientes: () => request('/api/clientes'),
  cliente: (id) => request(`/api/clientes/${id}`),

  // Consulta de Productos (Grupo G / Carro vía RabbitMQ RPC)
  productos: () => request('/api/productos'),

  // /api/health responde 200 o 207 con JSON; si falla la red, lanza el error.
  async salud() {
    const res = await fetch('/api/health');
    return res.json();
  }
};

