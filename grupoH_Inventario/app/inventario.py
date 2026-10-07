"""Lógica de negocio: descontar existencias de un pedido (sin RabbitMQ)."""
import json
from collections import defaultdict
from datetime import datetime


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def validar_pedido(datos: dict) -> dict:
    """Valida el contrato PedidoCreado. Lanza ValueError si no cumple."""
    if not isinstance(datos, dict):
        raise ValueError("El mensaje no es un objeto JSON")
    try:
        pedido_id = int(datos["pedidoId"])
    except (KeyError, TypeError, ValueError):
        raise ValueError("Falta 'pedidoId' o no es numérico")

    productos = datos.get("productos")
    if not isinstance(productos, list) or not productos:
        raise ValueError("'productos' debe ser una lista no vacía")

    items = []
    for p in productos:
        try:
            pid, cant = int(p["productoId"]), int(p["cantidad"])
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"Producto inválido: {p!r}")
        if cant <= 0:
            raise ValueError(f"Cantidad inválida para el producto {pid}")
        items.append((pid, cant))

    return {"pedidoId": pedido_id, "clienteId": datos.get("clienteId"), "items": items}


def procesar_pedido(conn, pedido: dict) -> tuple[dict, bool]:
    """
    Pasos: identificar productos -> consultar existencias -> verificar
    disponibilidad -> descontar -> construir el evento de respuesta.

    Todo ocurre en UNA transacción: o se descuentan todos los productos
    del pedido o ninguno. Devuelve (evento, repetido).
    """
    pedido_id = pedido["pedidoId"]

    # 1. Identificar productos (si un producto se repite, se suman cantidades)
    requeridos: dict[int, int] = defaultdict(int)
    for pid, cant in pedido["items"]:
        requeridos[pid] += cant
    ids = sorted(requeridos)

    with conn.cursor() as cur:
        # ¿Ya se procesó este pedido? (reentrega de RabbitMQ)
        cur.execute(
            "SELECT evento_json FROM PedidoProcesado WHERE pedido_id = %s",
            (pedido_id,),
        )
        previo = cur.fetchone()
        if previo:
            conn.rollback()
            return json.loads(previo["evento_json"]), True

        # 2. Consultar existencias (bloquea las filas hasta el commit)
        marcas = ",".join(["%s"] * len(ids))
        cur.execute(
            f"SELECT producto_id, cantidad FROM Inventario "
            f"WHERE producto_id IN ({marcas}) ORDER BY producto_id FOR UPDATE",
            ids,
        )
        existencias = {f["producto_id"]: f["cantidad"] for f in cur.fetchall()}

        # 3. Verificar disponibilidad (producto inexistente = 0 unidades)
        faltantes = [
            {
                "productoId": pid,
                "solicitado": requeridos[pid],
                "disponible": existencias.get(pid, 0),
            }
            for pid in ids
            if existencias.get(pid, 0) < requeridos[pid]
        ]

        if faltantes:
            resultado = "INSUFICIENTE"
            evento = {
                "evento": "InventarioInsuficiente",
                "pedidoId": pedido_id,
                "clienteId": pedido["clienteId"],
                "fecha": _ahora(),
                "faltantes": faltantes,
            }
        else:
            # 4. Descontar las unidades
            for pid in ids:
                cur.execute(
                    "UPDATE Inventario SET cantidad = cantidad - %s "
                    "WHERE producto_id = %s",
                    (requeridos[pid], pid),
                )
            resultado = "ACTUALIZADO"
            evento = {
                "evento": "InventarioActualizado",
                "pedidoId": pedido_id,
                "clienteId": pedido["clienteId"],
                "fecha": _ahora(),
                "productos": [
                    {"productoId": pid, "cantidad": requeridos[pid]} for pid in ids
                ],
            }

        cur.execute(
            "INSERT INTO PedidoProcesado (pedido_id, resultado, evento_json) "
            "VALUES (%s, %s, %s)",
            (pedido_id, resultado, json.dumps(evento)),
        )
    conn.commit()
    return evento, False

def ajustar_cantidad(conn, producto_id: int, cantidad: int, motivo: str | None = None) -> dict:
    """Fija la cantidad de un producto existente y deja registro del movimiento."""
    if cantidad < 0:
        raise ValueError("La cantidad no puede ser negativa")
    motivo = (motivo or "").strip()[:200] or "Recuento"
    with conn.cursor() as cur:
        cur.execute(
            "SELECT cantidad FROM Inventario WHERE producto_id = %s FOR UPDATE",
            (producto_id,),
        )
        fila = cur.fetchone()
        if not fila:
            conn.rollback()
            raise LookupError("Producto no encontrado en el inventario")
        cur.execute(
            "UPDATE Inventario SET cantidad = %s WHERE producto_id = %s",
            (cantidad, producto_id),
        )
        cur.execute(
            "INSERT INTO MovimientoInventario "
            "(producto_id, tipo, cantidad_anterior, cantidad_nueva, motivo) "
            "VALUES (%s, 'AJUSTE', %s, %s, %s)",
            (producto_id, fila["cantidad"], cantidad, motivo),
        )
        cur.execute(
            "SELECT producto_id, nombre, cantidad, actualizado "
            "FROM Inventario WHERE producto_id = %s",
            (producto_id,),
        )
        resultado = cur.fetchone()
    conn.commit()
    return resultado