// Middleware de autenticación y autorización JWT (HS256) para el módulo de Pedidos
const crypto = require('crypto');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_ALGORITHM = (process.env.JWT_ALGORITHM || 'HS256').toUpperCase();
const JWT_EXPIRES_IN = Number(process.env.JWT_EXPIRES_IN) || 1800;

const ROLES_VALIDOS = ['cliente', 'operador', 'administrador'];

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecodeToString(segment) {
  const normalized = String(segment).replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64').toString('utf8');
}

function base64UrlDecodeToBuffer(segment) {
  const normalized = String(segment).replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

/**
 * Firma un token JWT con algoritmo HS256 compatible con Clientes (Grupo F),
 * Pagos (Grupo B) e Inventario (Grupo H).
 */
function signJwt({ sub, role = 'cliente', clienteId = null, expiresInSeconds = JWT_EXPIRES_IN } = {}) {
  const ahora = Math.floor(Date.now() / 1000);
  const exp = ahora + Number(expiresInSeconds);

  const headerObj = { alg: 'HS256', typ: 'JWT' };
  const payloadObj = {
    sub: String(sub || 'usuario-demo'),
    role: String(role).toLowerCase(),
    rol: String(role).toLowerCase(),
    iat: ahora,
    exp
  };

  if (clienteId !== null && clienteId !== undefined && clienteId !== '') {
    payloadObj.clienteId = Number(clienteId);
  }

  const headerPart = base64UrlEncode(JSON.stringify(headerObj));
  const payloadPart = base64UrlEncode(JSON.stringify(payloadObj));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signaturePart = base64UrlEncode(
    crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest()
  );

  return {
    token: `${signingInput}.${signaturePart}`,
    claims: payloadObj,
    expiraEnSegundos: Number(expiresInSeconds)
  };
}

/**
 * Verifica y decodifica un token JWT HS256.
 * Lanza un objeto de error con { status: 401, message } si no es válido.
 */
function verifyJwt(token) {
  if (!token || typeof token !== 'string') {
    const err = new Error('Token requerido');
    err.status = 401;
    throw err;
  }

  if (JWT_ALGORITHM !== 'HS256') {
    const err = new Error('Algoritmo JWT no soportado por este servicio');
    err.status = 500;
    throw err;
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    const err = new Error('Token inválido: formato JWT mal formado');
    err.status = 401;
    throw err;
  }

  const [headerPart, payloadPart, signaturePart] = parts;

  let header;
  let claims;
  try {
    header = JSON.parse(base64UrlDecodeToString(headerPart));
    claims = JSON.parse(base64UrlDecodeToString(payloadPart));
  } catch {
    const err = new Error('Token inválido: no se pudo decodificar el contenido');
    err.status = 401;
    throw err;
  }

  if (!header || String(header.alg).toUpperCase() !== 'HS256') {
    const err = new Error('Token inválido: algoritmo no permitido');
    err.status = 401;
    throw err;
  }

  const signingInput = `${headerPart}.${payloadPart}`;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest();
  let providedSig;
  try {
    providedSig = base64UrlDecodeToBuffer(signaturePart);
  } catch {
    const err = new Error('Token inválido: firma mal codificada');
    err.status = 401;
    throw err;
  }

  if (
    expectedSig.length !== providedSig.length ||
    !crypto.timingSafeEqual(expectedSig, providedSig)
  ) {
    const err = new Error('Token inválido: la firma no coincide o el token fue alterado');
    err.status = 401;
    throw err;
  }

  const ahora = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    const err = new Error('Token sin fecha de expiración válida (exp)');
    err.status = 401;
    throw err;
  }

  if (claims.exp <= ahora) {
    const err = new Error('Token vencido');
    err.status = 401;
    throw err;
  }

  const sub = claims.sub !== undefined && claims.sub !== null ? String(claims.sub).trim() : '';
  if (!sub) {
    const err = new Error('Token sin identificador de usuario (sub)');
    err.status = 401;
    throw err;
  }

  // Soportar claim `role` (Pagos/Pedidos) o `rol`, y compatibilidad con tokens emitidos por Grupo F (auth.login)
  let rawRole = claims.role || claims.rol || null;
  if (!rawRole && sub === 'demo') {
    rawRole = 'operador';
  }

  if (!rawRole || typeof rawRole !== 'string') {
    const err = new Error('Token sin rol de usuario (role)');
    err.status = 401;
    throw err;
  }

  const role = rawRole.trim().toLowerCase();
  const rawClienteId = claims.clienteId ?? claims.cliente_id ?? null;
  let clienteId = null;

  if (rawClienteId !== null && rawClienteId !== undefined && rawClienteId !== '') {
    const parsed = Number(rawClienteId);
    if (!Number.isInteger(parsed) || parsed < 1) {
      const err = new Error('Identificador de cliente (clienteId) inválido en el token');
      err.status = 401;
      throw err;
    }
    clienteId = parsed;
  }

  return {
    id: sub,
    sub,
    role,
    clienteId,
    claims
  };
}

/**
 * Middleware Express que exige un token Bearer JWT válido en el header Authorization.
 */
function authenticateJwt(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const match = String(authHeader).match(/^Bearer\s+(.+)$/i);

  if (!match || !match[1]) {
    return res.status(401).json({
      error: 'Token requerido. Debes enviar el encabezado Authorization: Bearer <JWT>.'
    });
  }

  try {
    req.user = verifyJwt(match[1].trim());
    return next();
  } catch (err) {
    return res.status(err.status || 401).json({
      error: err.message || 'Token inválido o vencido'
    });
  }
}

/**
 * Middleware Express que valida que el usuario autenticado tenga uno de los roles permitidos.
 */
function requireRoles(...rolesPermitidos) {
  const normalizedAllowed = rolesPermitidos.map((r) => String(r).toLowerCase());

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Usuario no autenticado'
      });
    }

    if (!normalizedAllowed.includes(req.user.role)) {
      return res.status(403).json({
        error: `Acceso denegado: el rol "${req.user.role}" no tiene permisos para realizar esta acción.`,
        rolActual: req.user.role,
        rolesPermitidos: normalizedAllowed
      });
    }

    return next();
  };
}

module.exports = {
  ROLES_VALIDOS,
  signJwt,
  verifyJwt,
  authenticateJwt,
  requireRoles
};
