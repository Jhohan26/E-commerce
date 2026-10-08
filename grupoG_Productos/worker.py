import json
import logging
import os
import time
from datetime import date, datetime
from decimal import Decimal

import pika
import pymysql
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker")

# Mismas variables de entorno que usa el proyecto Node (.env)
DB_CONFIG = {
	"host": os.environ["DB_HOST"],
	"user": os.environ["DB_USER"],
	"password": os.environ["DB_PASSWORD"],
	"database": os.environ["DB_NAME"],
	"port": int(os.getenv("DB_PORT", "3306")),
	"charset": "utf8mb4",
	"cursorclass": pymysql.cursors.DictCursor,
}

CLOUDAMQP_URL = os.environ["CLOUDAMQP_URL"]
COLA_PRODUCTO = "producto.consultar"
COLA_PRODUCTOS = "productos.listar"

# Misma consulta que obtenerProductos en productoController.js
SELECT_PRODUCTOS = """
	SELECT
		p.id,
		p.nombre,
		p.precio,
		p.imagen_url,
		p.descripcion,
		p.categoria_id,
		c.nombre AS categoria
	FROM productos p
	INNER JOIN categorias c ON p.categoria_id = c.id
"""


def serializar(obj):
	# DECIMAL (precio) no es serializable por json -> se envía como número
	if isinstance(obj, Decimal):
		return float(obj)
	if isinstance(obj, (datetime, date)):
		return obj.isoformat()
	raise TypeError(f"Tipo no serializable: {type(obj)}")


def consultar_producto(cuerpo: bytes) -> dict:
	try:
		producto_id = int(json.loads(cuerpo)["id"])
	except (ValueError, KeyError, TypeError):
		return {"status": 400, "error": 'Se espera un JSON como {"id": 1}'}

	conn = pymysql.connect(**DB_CONFIG)
	try:
		with conn.cursor() as cur:
			cur.execute(SELECT_PRODUCTOS + " WHERE p.id = %s", (producto_id,))
			fila = cur.fetchone()
	finally:
		conn.close()

	if not fila:
		return {"status": 404, "error": "Producto no encontrado"}
	return {"status": 200, "data": fila}


def listar_productos(cuerpo: bytes) -> dict:
	conn = pymysql.connect(**DB_CONFIG)
	try:
		with conn.cursor() as cur:
			cur.execute(SELECT_PRODUCTOS + " ORDER BY p.id")
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
				body=json.dumps(respuesta, ensure_ascii=False, default=serializar).encode(),
			)
		ch.basic_ack(delivery_tag=method.delivery_tag)

	return callback


def ejecutar():
	params = pika.URLParameters(CLOUDAMQP_URL)
	params.heartbeat = 30
	connection = pika.BlockingConnection(params)
	channel = connection.channel()
	channel.basic_qos(prefetch_count=1)

	for cola, funcion in ((COLA_PRODUCTO, consultar_producto), (COLA_PRODUCTOS, listar_productos)):
		channel.queue_declare(queue=cola, durable=True)
		channel.basic_consume(queue=cola, on_message_callback=crear_callback(funcion))

	log.info("Worker listo. Escuchando: %s, %s", COLA_PRODUCTO, COLA_PRODUCTOS)
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
