"""Worker RPC de Inventario (RabbitMQ / CloudAMQP).

Mismo patrón que el worker de Clientes: escucha peticiones en colas
dedicadas y responde a la cola indicada en `reply_to`, copiando el
`correlation_id`.

Colas:
    inventario.consultar  -> cuerpo {"id": 15}  (también acepta "producto_id")
    inventario.listar     -> cuerpo vacío o {}

Respuesta (JSON):
    {"status": 200, "data": ...}
    {"status": 400 | 404 | 500, "error": "..."}

Ubicación: raíz del proyecto (junto a la carpeta app/).
Uso:       python worker_inventario.py
"""
import json
import logging
import os
import time
from datetime import date, datetime
from decimal import Decimal

import pika
from dotenv import load_dotenv

load_dotenv()

from app.db import get_conn  # reutiliza la conexión del proyecto (DictCursor)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker_inventario")

# Usa la misma variable que el resto del proyecto; CLOUDAMQP_URL como alternativa
RABBITMQ_URL = os.getenv("RABBITMQ_URL") or os.environ["CLOUDAMQP_URL"]
COLA_PRODUCTO = "inventario.consultar"
COLA_INVENTARIO = "inventario.listar"
COLUMNAS = "producto_id, nombre, cantidad, actualizado"


def _serializar(obj):
    """Permite json.dumps con los datetime/Decimal que devuelve MySQL."""
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"No serializable: {type(obj)}")


def consultar_producto(cuerpo: bytes) -> dict:
    try:
        datos = json.loads(cuerpo)
        valor = datos["id"] if "id" in datos else datos["producto_id"]
        producto_id = int(valor)
    except (ValueError, KeyError, TypeError):
        return {"status": 400, "error": 'Se espera un JSON como {"id": 15}'}

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT {COLUMNAS} FROM Inventario WHERE producto_id = %s",
                (producto_id,),
            )
            fila = cur.fetchone()
    finally:
        conn.close()

    if not fila:
        return {"status": 404, "error": "Producto no encontrado en el inventario"}
    return {"status": 200, "data": fila}


def listar_inventario(cuerpo: bytes) -> dict:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT {COLUMNAS} FROM Inventario ORDER BY producto_id")
            filas = cur.fetchall()
    finally:
        conn.close()
    return {"status": 200, "data": filas}


def crear_callback(funcion):
    def callback(ch, method, props, body):
        try:
            respuesta = funcion(body)
        except Exception:
            log.exception("Error procesando mensaje")
            respuesta = {"status": 500, "error": "Error interno"}

        if props.reply_to:
            ch.basic_publish(
                exchange="",
                routing_key=props.reply_to,
                properties=pika.BasicProperties(
                    correlation_id=props.correlation_id,
                    content_type="application/json",
                ),
                body=json.dumps(respuesta, ensure_ascii=False, default=_serializar).encode(),
            )
        ch.basic_ack(delivery_tag=method.delivery_tag)

    return callback


def ejecutar():
    params = pika.URLParameters(RABBITMQ_URL)
    params.heartbeat = 30
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    channel.basic_qos(prefetch_count=1)

    for cola, funcion in (
        (COLA_PRODUCTO, consultar_producto),
        (COLA_INVENTARIO, listar_inventario),
    ):
        channel.queue_declare(queue=cola, durable=True)
        channel.basic_consume(queue=cola, on_message_callback=crear_callback(funcion))

    log.info("Worker listo. Escuchando: %s, %s", COLA_PRODUCTO, COLA_INVENTARIO)
    channel.start_consuming()


if __name__ == "__main__":
    while True:
        try:
            ejecutar()
        except pika.exceptions.AMQPError as e:
            log.warning("Conexión perdida (%s). Reintentando en 5 s...", e)
            time.sleep(5)
        except KeyboardInterrupt:
            log.info("Worker detenido")
            break
