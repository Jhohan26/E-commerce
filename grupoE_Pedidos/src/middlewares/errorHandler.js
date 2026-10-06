// Manejador centralizado de errores HTTP y rutas 404

function notFoundApi(req, res) {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // JSON mal formado en el cuerpo de la petición
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido.' });
  }

  const status = err.status || 500;

  if (status >= 500) {
    console.error(`[Error] ${req.method} ${req.originalUrl}:`, err);
    const body = { error: 'Error interno del servidor.' };
    if (process.env.NODE_ENV !== 'production') body.detalle = err.message;
    return res.status(status).json(body);
  }

  return res.status(status).json({ error: err.message });
}

module.exports = { notFoundApi, errorHandler };
