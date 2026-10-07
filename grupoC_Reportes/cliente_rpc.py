"""Consulta al microservicio de Clientes (Grupo F) por RabbitMQ (patrón RPC).

El worker de Clientes (grupoF_Clientes/worker.py) escucha dos colas:
  cliente.consultar  {"id": N}  -> {"status": 200, "data": {...}} | {"status": 404, "error": ...}
  clientes.listar    (vacío)    -> {"status": 200, "data": [...]}

La URL del broker se lee de AMQP_URL (.env); nunca se escribe en el código.

Prueba rápida:
    python cliente_rpc.py        # lista todos los clientes
    python cliente_rpc.py 1      # consulta el cliente 1
"""
import json
import os
import sys
import time
import uuid

import pika
from dotenv import load_dotenv

load_dotenv()

COLA_CLIENTE = "cliente.consultar"
COLA_CLIENTES = "clientes.listar"


class ClientesError(Exception):
	"""status 404 = no existe; 502 = no se pudo hablar con el worker de Clientes."""

	def __init__(self, status: int, detalle: str):
		super().__init__(detalle)
		self.status = status
		self.detalle = detalle


class ClienteRPC:
	def __init__(self, url: str | None = None):
		url = url or os.getenv("AMQP_URL")
		if not url:
			raise ClientesError(502, "Falta AMQP_URL en el .env")
		params = pika.URLParameters(url)
		params.heartbeat = 30
		self.connection = pika.BlockingConnection(params)
		self.channel = self.connection.channel()
		self.cola_respuesta = self.channel.queue_declare(queue="", exclusive=True).method.queue
		self.respuesta = None
		self.corr_id = None
		self.channel.basic_consume(
			queue=self.cola_respuesta, on_message_callback=self._on_response, auto_ack=True
		)

	def _on_response(self, ch, method, props, body):
		if props.correlation_id == self.corr_id:
			self.respuesta = json.loads(body)

	def llamar(self, cola: str, payload: dict | None = None, timeout: int = 10) -> dict:
		self.respuesta = None
		self.corr_id = str(uuid.uuid4())
		self.channel.basic_publish(
			exchange="",
			routing_key=cola,
			properties=pika.BasicProperties(
				reply_to=self.cola_respuesta,
				correlation_id=self.corr_id,
				expiration=str(timeout * 1000),
			),
			body=json.dumps(payload).encode() if payload is not None else b"",
		)
		limite = time.monotonic() + timeout
		while self.respuesta is None and time.monotonic() < limite:
			self.connection.process_data_events(time_limit=1)
		if self.respuesta is None:
			raise TimeoutError("El worker de Clientes no respondió a tiempo")
		return self.respuesta

	def cerrar(self):
		self.connection.close()


def _llamar(cola: str, payload: dict | None = None):
	try:
		rpc = ClienteRPC()
		try:
			respuesta = rpc.llamar(cola, payload)
		finally:
			rpc.cerrar()
	except TimeoutError:
		raise ClientesError(502, "El worker de Clientes no respondió (¿está corriendo worker.py?)")
	except pika.exceptions.AMQPError:
		raise ClientesError(502, "No se pudo conectar con RabbitMQ")
	if respuesta.get("status") != 200:
		raise ClientesError(respuesta.get("status", 500), respuesta.get("error", "Error en Clientes"))
	return respuesta["data"]


def consultar_cliente(cliente_id: int) -> dict:
	return _llamar(COLA_CLIENTE, {"id": cliente_id})


def listar_clientes() -> list:
	return _llamar(COLA_CLIENTES)


if __name__ == "__main__":
	try:
		if len(sys.argv) > 1:
			resultado = consultar_cliente(int(sys.argv[1]))
		else:
			resultado = listar_clientes()
		print(json.dumps(resultado, indent=2, ensure_ascii=False, default=str))
	except ClientesError as e:
		print(f"Error {e.status}: {e.detalle}")
