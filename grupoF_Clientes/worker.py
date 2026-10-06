import json
import logging
import os
import time

import pika
import pymysql
from dotenv import load_dotenv

load_dotenv()

from main import CAMPOS_PUBLICOS, DB_CONFIG

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker")

CLOUDAMQP_URL = os.environ["CLOUDAMQP_URL"]
COLA_CLIENTE = "cliente.consultar"
COLA_CLIENTES = "clientes.listar"


def consultar_cliente(cuerpo: bytes) -> dict:
	try:
		cliente_id = int(json.loads(cuerpo)["id"])
	except (ValueError, KeyError, TypeError):
		return {"status": 400, "error": 'Se espera un JSON como {"id": 1}'}

	conn = pymysql.connect(**DB_CONFIG)
	try:
		with conn.cursor() as cur:
			cur.execute(f"SELECT {CAMPOS_PUBLICOS} FROM Cliente WHERE id = %s", (cliente_id,))
			fila = cur.fetchone()
	finally:
		conn.close()

	if not fila:
		return {"status": 404, "error": "Cliente no encontrado"}
	return {"status": 200, "data": fila}


def listar_clientes(cuerpo: bytes) -> dict:
	conn = pymysql.connect(**DB_CONFIG)
	try:
		with conn.cursor() as cur:
			cur.execute(f"SELECT {CAMPOS_PUBLICOS} FROM Cliente ORDER BY id")
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
				body=json.dumps(respuesta, ensure_ascii=False).encode(),
			)
		ch.basic_ack(delivery_tag=method.delivery_tag)

	return callback


def ejecutar():
	params = pika.URLParameters(CLOUDAMQP_URL)
	params.heartbeat = 30
	connection = pika.BlockingConnection(params)
	channel = connection.channel()
	channel.basic_qos(prefetch_count=1)

	for cola, funcion in ((COLA_CLIENTE, consultar_cliente), (COLA_CLIENTES, listar_clientes)):
		channel.queue_declare(queue=cola, durable=True)
		channel.basic_consume(queue=cola, on_message_callback=crear_callback(funcion))

	log.info("Worker listo. Escuchando: %s, %s", COLA_CLIENTE, COLA_CLIENTES)
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
