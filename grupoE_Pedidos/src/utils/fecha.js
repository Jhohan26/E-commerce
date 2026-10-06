// Genera fecha y hora local del servidor (formato ISO local y MySQL sin desfase UTC)
function ahoraLocal(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const fecha = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hora = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

  return {
    iso: `${fecha}T${hora}`,   // para el evento y la API: 2026-10-01T10:30:00
    mysql: `${fecha} ${hora}`  // para columnas DATETIME: 2026-10-01 10:30:00
  };
}

module.exports = { ahoraLocal };
