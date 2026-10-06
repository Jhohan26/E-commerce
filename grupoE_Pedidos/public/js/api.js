// Capa de acceso a la API REST del microservicio de Pedidos.

const BASE = '/api/pedidos';

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
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
  obtener: (id) => request(`${BASE}/${id}`),
  crear: (body) => request(BASE, { method: 'POST', body: JSON.stringify(body) }),
  cambiarEstado: (id, estado) =>
    request(`${BASE}/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado }) }),
  reenviarEvento: (id) => request(`${BASE}/${id}/reenviar-evento`, { method: 'POST' }),

  // /api/health responde 200 o 207 con JSON; si falla la red, lanza el error.
  async salud() {
    const res = await fetch('/api/health');
    return res.json();
  }
};
