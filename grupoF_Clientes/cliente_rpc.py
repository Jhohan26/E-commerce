import argparse
import json
import os
import time
import uuid

import pika
from dotenv import load_dotenv

load_dotenv()

CLOUDAMQP_URL = os.environ["CLOUDAMQP_URL"]
COLA_LOGIN = "auth.login"


class ErrorAPI(Exception):
	def __init__(self, status: int, mensaje: str):
		super().__init__(f"[{status}] {mensaje}")
		self.status = status


class ClienteRPC:
	def __init__(self, usuario: str, password: str):
		self.usuario = usuario
		self.password = password
		self.token = None

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

	def _enviar(self, cola: str, payload: dict | None, headers: dict | None, timeout: int) -> dict:
		self.respuesta = None
		self.corr_id = str(uuid.uuid4())
		self.channel.basic_publish(
			exchange="",
			routing_key=cola,
			properties=pika.BasicProperties(
				reply_to=self.cola_respuesta,
				correlation_id=self.corr_id,
				expiration=str(timeout * 1000),
				headers=headers,
			),
			body=json.dumps(payload).encode() if payload is not None else b"",
		)
		limite = time.monotonic() + timeout
		while self.respuesta is None and time.monotonic() < limite:
			self.connection.process_data_events(time_limit=1)
		if self.respuesta is None:
			raise TimeoutError("El worker no respondió a tiempo")
		return self.respuesta

	def login(self, timeout: int = 10) -> str:
		resp = self._enviar(
			COLA_LOGIN, {"usuario": self.usuario, "password": self.password}, None, timeout
		)
		if resp["status"] != 200:
			raise ErrorAPI(resp["status"], resp.get("error", "Error de autenticación"))
		self.token = resp["data"]["token"]
		return self.token

	def llamar(self, cola: str, payload: dict | None = None, timeout: int = 10) -> dict:
		if self.token is None:
			self.login(timeout)

		for intento in range(2):
			resp = self._enviar(cola, payload, {"Authorization": f"Bearer {self.token}"}, timeout)
			# Si el token expiró, se renueva una sola vez y se reintenta
			if resp["status"] == 401 and intento == 0:
				self.login(timeout)
				continue
			break
		return resp

	def cerrar(self):
		self.connection.close()


if __name__ == "__main__":
	parser = argparse.ArgumentParser(description="Cliente RPC con autenticación JWT")
	parser.add_argument("id", nargs="?", type=int, help="ID del cliente (si se omite, lista todos)")
	parser.add_argument("-u", "--usuario", default=os.environ.get("API_USUARIO"))
	parser.add_argument("-p", "--password", default=os.environ.get("API_PASSWORD"))
	args = parser.parse_args()

	if not args.usuario or not args.password:
		parser.error("Indica usuario y contraseña con -u/-p o con API_USUARIO/API_PASSWORD en el .env")

	rpc = ClienteRPC(args.usuario, args.password)
	try:
		if args.id is not None:
			resultado = rpc.llamar("cliente.consultar", {"id": args.id})
		else:
			resultado = rpc.llamar("clientes.listar")
		print(json.dumps(resultado, indent=2, ensure_ascii=False))
	except ErrorAPI as e:
		print(f"Error: {e}")
	finally:
		rpc.cerrar()
