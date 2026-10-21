"""Validación de JWT y autorización por rol para la API del carrito (Semana 9, fases 3 y 4).

Este módulo NO emite tokens: el inicio de sesión es responsabilidad del módulo de autenticación
(`auth.login`, Grupo F). El carrito solo VERIFICA los tokens que ese módulo firma, usando la clave
compartida (HS256 por defecto). Nunca se acepta un user_id o un rol enviado en el cuerpo de la
solicitud: la identidad y el rol salen únicamente de los claims de un token con firma válida.

Configuración (variables de entorno, leídas en cada petición):
    JWT_SECRET            clave compartida de firma. OBLIGATORIA para la API protegida. Si falta, la API
                          protegida responde 503 (falla cerrada); la interfaz web sigue funcionando.
    JWT_ALGORITHM         algoritmo permitido (por defecto HS256). Solo se acepta este, nunca "none".
    JWT_ISSUER            si se define, el claim `iss` debe coincidir.
    JWT_CLAIM_ROL         claim del rol (por defecto "rol"; si no existe se prueba "role").
    JWT_CLAIM_CLIENTE_ID  claim con el id de cliente dueño del carrito (por defecto "cliente_id";
                          si no existe se usa `sub` cuando es numérico).

Claims exigidos: `exp`, `sub` y un rol válido.
Roles reconocidos: cliente, operador, administrador.
"""

import os
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer

ROL_CLIENTE = "cliente"
ROL_OPERADOR = "operador"
ROL_ADMIN = "administrador"
ROLES_VALIDOS = {ROL_CLIENTE, ROL_OPERADOR, ROL_ADMIN}
_ALIAS_ROLES = {"admin": ROL_ADMIN, "administrator": ROL_ADMIN, "operator": ROL_OPERADOR, "customer": ROL_CLIENTE}


@dataclass(frozen=True)
class Usuario:
    """Identidad verificada a partir de un JWT válido."""

    id: str
    rol: str
    cliente_id: int | None
    claims: dict


# Solo para que /docs (Swagger) muestre el botón "Authorize". La validación real es _extraer_token().
_esquema_openapi = HTTPBearer(auto_error=False, description="JWT emitido por el módulo de autenticación (Grupo F)")


def _no_autenticado(detalle: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detalle, headers={"WWW-Authenticate": "Bearer"})


def _extraer_token(request: Request) -> str:
    cabecera = request.headers.get("Authorization", "")
    esquema, _, token = cabecera.partition(" ")
    if esquema.lower() != "bearer" or not token.strip():
        raise _no_autenticado("Falta el encabezado 'Authorization: Bearer <token>'.")
    return token.strip()


def _entero(valor) -> int | None:
    try:
        return int(str(valor))
    except (TypeError, ValueError):
        return None


def decodificar_token(token: str) -> Usuario:
    """Verifica firma, expiración y claims. Lanza HTTPException 401 (inválido/vencido) o 503 (sin clave)."""
    secreto = os.getenv("JWT_SECRET")
    if not secreto:
        raise HTTPException(status_code=503, detail="Autenticación no configurada en el servidor (falta JWT_SECRET).")
    algoritmo = os.getenv("JWT_ALGORITHM", "HS256").strip() or "HS256"
    emisor = os.getenv("JWT_ISSUER") or None

    try:
        claims = jwt.decode(
            token,
            secreto,
            algorithms=[algoritmo],  # lista cerrada: impide aceptar alg=none o cambiar de algoritmo
            issuer=emisor,
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise _no_autenticado("El token está vencido.")
    except jwt.InvalidTokenError as e:  # firma alterada, formato roto, claims faltantes, emisor distinto...
        raise _no_autenticado(f"Token inválido: {e}")

    claim_rol = os.getenv("JWT_CLAIM_ROL", "rol")
    rol = claims.get(claim_rol) or claims.get("role")
    rol = _ALIAS_ROLES.get(str(rol).strip().lower(), str(rol).strip().lower()) if rol else None
    if rol not in ROLES_VALIDOS:
        raise _no_autenticado("Token inválido: el rol no existe o no es reconocido.")

    claim_cliente = os.getenv("JWT_CLAIM_CLIENTE_ID", "cliente_id")
    cliente_id = _entero(claims.get(claim_cliente))
    if cliente_id is None:
        cliente_id = _entero(claims.get("sub"))

    return Usuario(id=str(claims["sub"]), rol=rol, cliente_id=cliente_id, claims=claims)


def usuario_actual(request: Request, _swagger=Depends(_esquema_openapi)) -> Usuario:
    """Dependencia FastAPI: exige un Bearer token válido y devuelve la identidad verificada."""
    return decodificar_token(_extraer_token(request))


def requiere_roles(*roles: str):
    """Dependencia FastAPI: token válido (401 si no) y rol permitido (403 si no)."""
    permitidos = set(roles)

    def _dependencia(usuario: Usuario = Depends(usuario_actual)) -> Usuario:
        if usuario.rol not in permitidos:
            raise HTTPException(
                status_code=403,
                detail=f"El rol '{usuario.rol}' no tiene permiso para esta operación.",
            )
        return usuario

    return _dependencia


def exigir_propietario(usuario: Usuario, cliente_id: int) -> None:
    """Un cliente solo puede operar sobre SU carrito; el administrador no está limitado por esta regla."""
    if usuario.rol == ROL_ADMIN:
        return
    if usuario.cliente_id is None or usuario.cliente_id != cliente_id:
        raise HTTPException(status_code=403, detail="No puedes acceder al carrito de otro cliente.")
