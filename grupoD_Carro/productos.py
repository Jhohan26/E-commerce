"""Catálogo de productos (consumido del microservicio del Grupo G).

Se consulta por RPC sobre CloudAMQP a las colas del worker de Productos:

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
import time

import rabbit

COLA_LISTAR = "productos.listar"

_TTL_SEGUNDOS = 5          # cada cuánto se refresca el catálogo si Productos responde
_REINTENTO_SEGUNDOS = 15   # tras un fallo, no insistir antes de esto (evita esperas)
_TIMEOUT_RPC = 4           # segundos de espera por la respuesta de Productos
_ARCHIVO_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalogo_cache.json")

_NUNCA = float("-inf")
_estado: dict = {"productos": None, "ultimo_ok": _NUNCA, "ultimo_fallo": _NUNCA}


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
        resp = rabbit.llamar_rpc(COLA_LISTAR, None, _TIMEOUT_RPC)
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
