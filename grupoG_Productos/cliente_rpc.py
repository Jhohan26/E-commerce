import json
import os
import sys
import time
import uuid

import pika
from dotenv import load_dotenv

load_dotenv()

CLOUDAMQP_URL = "amqps://yychnpmp:GhdH4NfHUJq2kXLFvFCYNqbxV0w8OUcz@campbell.lmq.cloudamqp.com/yychnpmp"
COLA_PRODUCTO = "producto.consultar"
COLA_PRODUCTOS = "productos.listar"


class ClienteRPC:
	def __init__(self):
		params = pika.URLParameters(CLOUDAMQP_URL)
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
			raise TimeoutError("El worker no respondió a tiempo")
		return self.respuesta

	def cerrar(self):
		self.connection.close()

	# Métodos de conveniencia para el microservicio de productos
	def consultar_producto(self, producto_id: int) -> dict:
		return self.llamar(COLA_PRODUCTO, {"id": producto_id})

	def listar_productos(self) -> dict:
		return self.llamar(COLA_PRODUCTOS)


if __name__ == "__main__":
	rpc = ClienteRPC()
	try:
		if len(sys.argv) > 1:
			resultado = rpc.consultar_producto(int(sys.argv[1]))
		else:
			resultado = rpc.listar_productos()
		print(json.dumps(resultado, indent=2, ensure_ascii=False))
	finally:
		rpc.cerrar()
