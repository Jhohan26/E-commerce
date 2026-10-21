"""Catálogo de productos (consumido del microservicio del Grupo G).

Se consulta por RPC sobre CloudAMQP a las colas del worker de Productos, que ahora
exige JWT. La autenticación la resuelve cliente_rpc.py (login en `productos.login`
con PRODUCTOS_USUARIO / PRODUCTOS_PASSWORD del .env y token en el header
Authorization; si el worker responde 401 renueva el token y reintenta una vez):

    productos.login      ({"usuario", "password"}) -> token JWT
    productos.listar     (cuerpo vacío)  -> todos los productos
    producto.consultar   ({"id": 1})     -> un producto

main.py sigue usando solo `listar_productos()` y `obtener_producto(id)`,
con el mismo formato de siempre: {"id", "nombre", "precio"} (+ extras).

Comportamiento:
- Productos nuevos, modificados o eliminados se reflejan solos: el catálogo se
  vuelve a pedir a Productos cada _TTL_SEGUNDOS (la respuesta REEMPLAZA al
  catálogo anterior, así lo eliminado desaparece).
- Si Productos está apagado, el carrito sigue con el ÚLTIMO catálogo conocido
  (también tras reiniciar el carrito, porque se guarda en catalogo_cache.json)
  y se puede continuar con el pedido. Cuando Productos vuelve, se resincroniza.
"""

import json
import os
import threading
import time

import pika
from dotenv import load_dotenv

from cliente_rpc import ClienteRPC

load_dotenv()

PRODUCTOS_USUARIO = os.getenv("PRODUCTOS_USUARIO")
PRODUCTOS_PASSWORD = os.getenv("PRODUCTOS_PASSWORD")

_TTL_SEGUNDOS = 5          # cada cuánto se refresca el catálogo si Productos responde
_REINTENTO_SEGUNDOS = 15   # tras un fallo, no insistir antes de esto (evita esperas)
_TIMEOUT_RPC = 4           # segundos de espera por la respuesta de Productos
_ARCHIVO_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalogo_cache.json")

# ClienteRPC mantiene una conexión pika (BlockingConnection), que NO es segura entre hilos y
# FastAPI atiende cada petición en un hilo distinto: se usa una sola instancia protegida por lock.
_rpc: ClienteRPC | None = None
_rpc_lock = threading.Lock()

_NUNCA = float("-inf")
_estado: dict = {"productos": None, "ultimo_ok": _NUNCA, "ultimo_fallo": _NUNCA}


def _cerrar_rpc() -> None:
    global _rpc
    if _rpc is not None:
        try:
            _rpc.cerrar()
        except Exception:
            pass
        _rpc = None


def _pedir_catalogo() -> dict:
    """Pide el catálogo a Productos con JWT (cliente_rpc.py). Si la conexión se cayó (p. ej. porque
    estuvo ociosa y CloudAMQP la cerró) reconecta y reintenta una vez, conservando el token."""
    global _rpc
    if not PRODUCTOS_USUARIO or not PRODUCTOS_PASSWORD:
        raise RuntimeError("Faltan PRODUCTOS_USUARIO y PRODUCTOS_PASSWORD en el .env para autenticarse con Productos.")
    with _rpc_lock:
        token = None
        for intento in range(2):
            try:
                if _rpc is None:
                    _rpc = ClienteRPC(PRODUCTOS_USUARIO, PRODUCTOS_PASSWORD)
                    _rpc.token = token
                return _rpc.listar_productos(timeout=_TIMEOUT_RPC)
            except (pika.exceptions.AMQPError, OSError):
                token = _rpc.token if _rpc is not None else token
                _cerrar_rpc()
                if intento == 1:
                    raise


def _normalizar(p: dict) -> dict:
    """Adapta el producto del Grupo G al formato que usa el carrito."""
    return {
        "id": int(p["id"]),
        "nombre": p["nombre"],
        "precio": int(round(float(p["precio"]))),  # el worker envía 2500000.0
        "imagen_url": p.get("imagen_url"),
        "descripcion": p.get("descripcion"),
        "categoria_id": p.get("categoria_id"),
        "categoria": p.get("categoria"),
    }


def _guardar_en_disco(productos: list[dict]) -> None:
    try:
        tmp = _ARCHIVO_CACHE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(productos, f, ensure_ascii=False)
        os.replace(tmp, _ARCHIVO_CACHE)
    except OSError as e:
        print(f"[productos] no se pudo guardar el catálogo en disco: {e}")


def _leer_de_disco() -> list[dict]:
    try:
        with open(_ARCHIVO_CACHE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def _ultimo_catalogo() -> list[dict]:
    if _estado["productos"] is None:  # recién iniciado el carrito
        _estado["productos"] = _leer_de_disco()
    return _estado["productos"]


def listar_productos() -> list[dict]:
    ahora = time.monotonic()
    catalogo = _ultimo_catalogo()

    if catalogo and ahora - _estado["ultimo_ok"] < _TTL_SEGUNDOS:
        return catalogo  # catálogo fresco
    if ahora - _estado["ultimo_fallo"] < _REINTENTO_SEGUNDOS:
        return catalogo  # Productos acaba de fallar: seguir con el último catálogo

    try:
        resp = _pedir_catalogo()
        if resp.get("status") != 200:
            raise RuntimeError(resp.get("error", f"status {resp.get('status')}"))
        nuevo = [_normalizar(p) for p in resp["data"]]
    except Exception as e:  # Productos apagado, sin conexión, timeout, error 500...
        _estado["ultimo_fallo"] = ahora
        print(f"[productos] sin respuesta de Productos, se usa el último catálogo: {e}")
        return catalogo

    _estado.update(productos=nuevo, ultimo_ok=ahora, ultimo_fallo=_NUNCA)
    _guardar_en_disco(nuevo)
    return nuevo


def obtener_producto(producto_id: int) -> dict | None:
    return next((p for p in listar_productos() if p["id"] == producto_id), None)
