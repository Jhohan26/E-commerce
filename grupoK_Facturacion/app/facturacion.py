"""Lógica de negocio: generar la factura de un pago aprobado (sin RabbitMQ)."""
import json
import logging
import os
import urllib.request
from datetime import datetime

import pymysql
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("facturacion")

CLIENTES_URL = os.getenv("CLIENTES_URL", "http://localhost:8000")
COLUMNAS_FILTRO = ("id", "pedido_id", "cliente_id")


def validar_pago(datos: dict) -> dict:
    """Valida el contrato PagoAprobado. Lanza ValueError si no cumple.

    Obligatorios: pedidoId y total. Opcionales: pagoId, clienteId y productos.
    """
    if not isinstance(datos, dict):
        raise ValueError("El mensaje no es un objeto JSON")

    try:
        pedido_id = int(datos["pedidoId"])
    except (KeyError, TypeError, ValueError):
        raise ValueError("Falta 'pedidoId' o no es numérico")

    try:
        total = float(datos["total"])
    except (KeyError, TypeError, ValueError):
        raise ValueError("Falta 'total' o no es numérico")
    if total < 0:
        raise ValueError("'total' no puede ser negativo")

    def opcional(campo):
        valor = datos.get(campo)
        if valor is None:
            return None
        try:
            return int(valor)
        except (TypeError, ValueError):
            raise ValueError(f"'{campo}' no es numérico")

    crudos = datos.get("productos")
    if crudos is None:
        crudos = []
    if not isinstance(crudos, list):
        raise ValueError("'productos' debe ser una lista")
    productos = []
    for p in crudos:
        try:
            productos.append({
                "productoId": int(p["productoId"]),
                "cantidad": int(p["cantidad"]),
                "precio": float(p["precio"]),
            })
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"Producto inválido: {p!r}")

    return {
        "pedidoId": pedido_id,
        "pagoId": opcional("pagoId"),
        "clienteId": opcional("clienteId"),
        "total": total,
        "productos": productos,
    }


def obtener_cliente(cliente_id: int):
    """Consulta SINCRÓNICA al microservicio de Clientes (POST /cliente).

    Devuelve None si no responde: la factura se genera igual, sin nombre ni correo.
    """
    req = urllib.request.Request(
        f"{CLIENTES_URL}/cliente",
        data=json.dumps({"id": cliente_id}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.loads(r.read())
    except Exception as e:
        log.warning("Clientes no disponible, se factura sin sus datos (%s)", e)
        return None


def _fila(f: dict) -> dict:
    f["productos"] = json.loads(f["productos"])
    f["fecha"] = f["fecha"].isoformat(timespec="seconds")
    f["total"] = float(f["total"])
    f.pop("creada_en", None)
    return f


def consultar(conn, campo=None, valor=None) -> list[dict]:
    """Lista facturas (todas, o filtradas por id / pedido_id / cliente_id)."""
    sql, args = "SELECT * FROM Factura", ()
    if campo is not None:
        if campo not in COLUMNAS_FILTRO:
            raise ValueError("campo no permitido")
        sql += f" WHERE {campo} = %s"
        args = (valor,)
    with conn.cursor() as cur:
        cur.execute(sql + " ORDER BY id DESC", args)
        return [_fila(f) for f in cur.fetchall()]


def evento_factura(f: dict) -> dict:
    """Construye el evento FacturaGenerada a partir de una factura guardada."""
    return {
        "evento": "FacturaGenerada",
        "facturaId": f["id"],
        "numeroFactura": f["numero"],
        "pedidoId": f["pedido_id"],
        "clienteId": f["cliente_id"],
        "fecha": f["fecha"],
        "total": f["total"],
    }


def procesar_pago(conn, pago: dict) -> tuple[dict, bool]:
    """
    Pasos: ver si el pedido ya está facturado -> consultar al cliente ->
    registrar la factura -> construir el evento de respuesta.

    Devuelve (evento FacturaGenerada, repetido). Si el pedido ya tenía factura
    no se crea otra: se reenvía el mismo evento.
    """
    existente = consultar(conn, "pedido_id", pago["pedidoId"])
    if existente:
        conn.rollback()
        return evento_factura(existente[0]), True

    # Consulta síncrona a Clientes (se hace antes de abrir la transacción de escritura)
    nombre = correo = None
    if pago["clienteId"] is not None:
        cliente = obtener_cliente(pago["clienteId"])
        if cliente:
            partes = (cliente.get("primer_nombre"), cliente.get("segundo_nombre"),
                      cliente.get("primer_apellido"), cliente.get("segundo_apellido"))
            nombre = " ".join(p for p in partes if p) or None
            correo = cliente.get("correo")

    ahora = datetime.now().replace(microsecond=0)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO Factura (pedido_id, pago_id, cliente_id, cliente_nombre, "
                "cliente_correo, fecha, total, productos) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (pago["pedidoId"], pago["pagoId"], pago["clienteId"], nombre, correo,
                 ahora, pago["total"], json.dumps(pago["productos"])),
            )
            factura_id = cur.lastrowid
            cur.execute(
                "UPDATE Factura SET numero = %s WHERE id = %s",
                (f"FAC-{ahora.year}-{factura_id:05d}", factura_id),
            )
        conn.commit()
    except pymysql.err.IntegrityError:
        # Otra entrega del mismo pedido se coló antes: usar la factura que ya existe
        conn.rollback()
        previa = consultar(conn, "pedido_id", pago["pedidoId"])
        if not previa:
            raise
        conn.rollback()
        return evento_factura(previa[0]), True
    except Exception:
        conn.rollback()
        raise

    factura = consultar(conn, "id", factura_id)[0]
    conn.rollback()  # cierra la transacción de solo lectura
    return evento_factura(factura), False
