"""API REST protegida del carrito (Semana 9: autenticación JWT + autorización por rol).

La interfaz web (`/`, `/cliente/...`) sigue funcionando igual. Esta capa añade endpoints JSON que
SÍ exigen un JWT válido y comprueban rol y propiedad del carrito. Reutiliza el mismo carrito en
memoria y las mismas funciones de RabbitMQ que la interfaz web.

    Endpoint                                   Acceso
    GET    /health, /ready                     Público (sondas de Kubernetes)
    GET    /api/productos                      Público
    GET    /api/carrito/{cliente_id}           cliente (solo el suyo) · administrador
    POST   /api/carrito/{cliente_id}/items     cliente (solo el suyo)
    DELETE /api/carrito/{cliente_id}/items/{producto_id}   cliente (solo el suyo)
    DELETE /api/carrito/{cliente_id}           cliente (solo el suyo)
    POST   /api/carrito/{cliente_id}/pedido    cliente (solo el suyo)

El operador no tiene operaciones en el carrito (su rol es de inventario): recibe 403.
"""

import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import productos as catalogo
import rabbit
from auth import ROL_ADMIN, ROL_CLIENTE, Usuario, exigir_propietario, requiere_roles


class ItemNuevo(BaseModel):
    producto_id: int
    cantidad: int = Field(1, gt=0, le=1000)


def crear_router(carritos: dict[int, dict[int, int]], lineas_carrito) -> APIRouter:
    router = APIRouter()
    solo_cliente = requiere_roles(ROL_CLIENTE)
    cliente_o_admin = requiere_roles(ROL_CLIENTE, ROL_ADMIN)

    # ---- Públicos -------------------------------------------------------------------------------
    @router.get("/health", tags=["salud"])
    def health():
        """Liveness: el proceso responde. No toca RabbitMQ (evita abrir conexiones en cada sonda)."""
        return {"status": "ok"}

    @router.get("/ready", tags=["salud"])
    def ready():
        """Readiness: la configuración mínima está presente."""
        faltan = [v for v in ("CLOUDAMQP_URL",) if not os.getenv(v)]
        if faltan:
            raise HTTPException(status_code=503, detail=f"Falta configuración: {', '.join(faltan)}")
        return {"status": "ready", "jwt_configurado": bool(os.getenv("JWT_SECRET"))}

    @router.get("/api/productos", tags=["productos"])
    def listar_productos():
        return catalogo.listar_productos()

    # ---- Protegidos -----------------------------------------------------------------------------
    @router.get("/api/carrito/{cliente_id}", tags=["carrito"])
    def ver_carrito(cliente_id: int, usuario: Usuario = Depends(cliente_o_admin)):
        exigir_propietario(usuario, cliente_id)
        lineas, total = lineas_carrito(cliente_id)
        return {"cliente_id": cliente_id, "lineas": lineas, "total": total}

    @router.post("/api/carrito/{cliente_id}/items", status_code=201, tags=["carrito"])
    def agregar_item(cliente_id: int, item: ItemNuevo, usuario: Usuario = Depends(solo_cliente)):
        exigir_propietario(usuario, cliente_id)
        if not catalogo.obtener_producto(item.producto_id):
            raise HTTPException(status_code=404, detail=f"No existe el producto {item.producto_id}.")
        carrito = carritos.setdefault(cliente_id, {})
        carrito[item.producto_id] = carrito.get(item.producto_id, 0) + item.cantidad
        lineas, total = lineas_carrito(cliente_id)
        return {"cliente_id": cliente_id, "lineas": lineas, "total": total}

    @router.delete("/api/carrito/{cliente_id}/items/{producto_id}", tags=["carrito"])
    def quitar_item(cliente_id: int, producto_id: int, usuario: Usuario = Depends(solo_cliente)):
        exigir_propietario(usuario, cliente_id)
        if producto_id not in carritos.get(cliente_id, {}):
            raise HTTPException(status_code=404, detail="Ese producto no está en el carrito.")
        carritos[cliente_id].pop(producto_id)
        lineas, total = lineas_carrito(cliente_id)
        return {"cliente_id": cliente_id, "lineas": lineas, "total": total}

    @router.delete("/api/carrito/{cliente_id}", tags=["carrito"])
    def vaciar_carrito(cliente_id: int, usuario: Usuario = Depends(solo_cliente)):
        exigir_propietario(usuario, cliente_id)
        carritos.pop(cliente_id, None)
        return {"cliente_id": cliente_id, "lineas": [], "total": 0}

    @router.post("/api/carrito/{cliente_id}/pedido", status_code=201, tags=["pedidos"])
    def crear_pedido(cliente_id: int, usuario: Usuario = Depends(solo_cliente)):
        exigir_propietario(usuario, cliente_id)  # antes de consultar nada: no revela si otros ids existen

        try:
            cliente = rabbit.consultar_cliente(cliente_id)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"No se pudo consultar el cliente: {e}")
        if cliente is None:
            raise HTTPException(status_code=404, detail=f"No existe un cliente con id {cliente_id}.")
        if cliente.get("estado") == 0:
            raise HTTPException(status_code=403, detail="Este cliente está deshabilitado y no puede comprar.")

        lineas, _total = lineas_carrito(cliente_id)
        if not lineas:
            raise HTTPException(status_code=409, detail="El carrito está vacío.")

        items = [{"productoId": l["id"], "cantidad": l["cantidad"], "precio": l["precio"]} for l in lineas]
        nombre = " ".join(
            p.strip()
            for p in (cliente.get("primer_nombre"), cliente.get("segundo_nombre"),
                      cliente.get("primer_apellido"), cliente.get("segundo_apellido"))
            if p and p.strip()
        )
        try:
            evento = rabbit.publicar_pedido(cliente_id, items, cliente_nombre=nombre)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"No se pudo enviar el pedido: {e}")

        carritos.pop(cliente_id, None)
        return evento

    return router
