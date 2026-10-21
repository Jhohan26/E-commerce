// Rutas públicas y de verificación para emitir y probar tokens JWT por rol
const express = require('express');
const router = express.Router();
const { signJwt, authenticateJwt, ROLES_VALIDOS } = require('../middlewares/authMiddleware');

const PERFILES_DEMO = {
  administrador: { sub: 'admin-1', role: 'administrador', clienteId: null },
  operador: { sub: 'operador-1', role: 'operador', clienteId: null },
  cliente: { sub: 'cliente-1', role: 'cliente', clienteId: 1 }
};

function emitirTokenHandler(req, res) {
  const body = req.body || {};
  const rawRole = String(body.role || body.rol || 'cliente').trim().toLowerCase();

  if (!ROLES_VALIDOS.includes(rawRole)) {
    return res.status(400).json({
      error: `Rol inválido "${rawRole}". Los roles permitidos son: ${ROLES_VALIDOS.join(', ')}.`
    });
  }

  const base = PERFILES_DEMO[rawRole];
  const clienteId =
    body.clienteId !== undefined && body.clienteId !== null && body.clienteId !== ''
      ? Number(body.clienteId)
      : base.clienteId;

  if (rawRole === 'cliente' && (!Number.isInteger(clienteId) || clienteId < 1)) {
    return res.status(400).json({
      error: 'Para el rol "cliente" el campo clienteId debe ser un entero positivo.'
    });
  }

  const sub =
    body.sub ||
    body.usuario ||
    (rawRole === 'cliente' ? `cliente-${clienteId}` : base.sub);

  // Permite generar tokens vencidos a propósito para probar el Caso 5 de Postman (token vencido -> 401)
  const vencido = Boolean(body.vencido || body.expired);
  const expiresInSeconds = vencido
    ? -60
    : Number(body.expiresInSeconds || body.expiraEnSegundos || process.env.JWT_EXPIRES_IN || 1800);

  const { token, claims, expiraEnSegundos } = signJwt({
    sub,
    role: rawRole,
    clienteId: rawRole === 'cliente' ? clienteId : clienteId || null,
    expiresInSeconds
  });

  return res.status(200).json({
    mensaje: vencido
      ? 'Token JWT vencido generado para pruebas de expiración (401).'
      : `Token JWT emitido para el rol "${rawRole}".`,
    token,
    tipo: 'Bearer',
    expiraEnSegundos,
    usuario: {
      sub: claims.sub,
      role: claims.role,
      clienteId: claims.clienteId ?? null
    },
    claims
  });
}

router.post('/token', emitirTokenHandler);
router.post('/login', emitirTokenHandler);

router.get('/me', authenticateJwt, (req, res) => {
  res.json({
    autenticado: true,
    usuario: {
      id: req.user.id,
      sub: req.user.sub,
      role: req.user.role,
      clienteId: req.user.clienteId
    },
    claims: req.user.claims
  });
});

module.exports = router;
