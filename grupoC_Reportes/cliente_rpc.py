"""Consulta al microservicio de Clientes (Grupo F) por RabbitMQ (patrón RPC).

El worker de Clientes (grupoF_Clientes/worker.py) escucha dos colas:
  cliente.consultar  {"id": N}  -> {"status": 200, "data": {...}} | {"status": 404, "error": ...}
  clientes.listar    (vacío)    -> {"status": 200, "data": [...]}

La URL del broker se lee de AMQP_URL (.env); nunca se escribe en el código.

Autenticación JWT: Clientes (cola auth.login), Inventario (cola inventario.login) y Productos (cola productos.login) exigen un token.
Reportes inicia sesión con el usuario y la contraseña que le entregó cada grupo (.env), guarda el token
en memoria, lo envía en el header AMQP "Authorization: Bearer <token>" y, si el worker responde 401
(token vencido), vuelve a iniciar sesión y reintenta una vez.

Prueba rápida:
    python cliente_rpc.py        # lista todos los clientes
    python cliente_rpc.py 1      # consulta el cliente 1
"""
import json
import os
import sys
import threading
import time
import uuid

import pika
from dotenv import load_dotenv

load_dotenv()

COLA_CLIENTE = "cliente.consultar"
COLA_CLIENTES = "clientes.listar"
# Productos (Grupo G) usa el mismo patrón: su worker.py escucha estas dos colas
COLA_PRODUCTO = os.getenv("AMQP_COLA_PRODUCTO", "producto.consultar")
COLA_PRODUCTOS = os.getenv("AMQP_COLA_PRODUCTOS", "productos.listar")
# Pedidos e Inventario aún publican solo una API web; si crean un worker con estos nombres, Reportes lo usa solo.
COLA_PEDIDOS = os.getenv("AMQP_COLA_PEDIDOS", "pedidos.listar")
COLA_INVENTARIO_LISTAR = os.getenv("AMQP_COLA_INVENTARIO_LISTAR", "inventario.listar")

# Colas que exigen JWT -> (cola de login, prefijo de las variables del .env, grupo que entrega la cuenta).
# Pedidos (RPC) aún no pide token; si lo agrega, basta con sumarlo aquí.
_LOGIN_CLIENTES = (os.getenv("AMQP_COLA_LOGIN_CLIENTES", "auth.login"), "CLIENTES_RPC", "Clientes (Grupo F)")
_LOGIN_INVENTARIO = (os.getenv("AMQP_COLA_LOGIN_INVENTARIO", "inventario.login"), "INVENTARIO_RPC", "Inventario (Grupo H)")
_LOGIN_PRODUCTOS = (os.getenv("AMQP_COLA_LOGIN_PRODUCTOS", "productos.login"), "PRODUCTOS_RPC", "Productos (Grupo G)")
LOGIN_POR_COLA = {
	COLA_CLIENTE: _LOGIN_CLIENTES,
	COLA_CLIENTES: _LOGIN_CLIENTES,
	COLA_INVENTARIO_LISTAR: _LOGIN_INVENTARIO,
	COLA_PRODUCTO: _LOGIN_PRODUCTOS,
	COLA_PRODUCTOS: _LOGIN_PRODUCTOS,
}
_tokens: dict = {}              # cola de login -> (token, momento en que se debe renovar)
_candado_tokens = threading.Lock()


class ClientesError(Exception):
	"""status 404 = no existe; 502 = no se pudo hablar con el worker de Clientes."""

	def __init__(self, status: int, detalle: str):
		super().__init__(detalle)
		self.status = status
		self.detalle = detalle


class SinRespuesta(Exception):
	"""RabbitMQ conectó, pero el worker de Clientes no contestó a tiempo (probablemente está apagado)."""


class ClienteRPC:
	def __init__(self, url: str | None = None):
		url = url or os.getenv("AMQP_URL")
		if not url:
			raise ClientesError(502, "Falta AMQP_URL en el .env")
		params = pika.URLParameters(url)
		params.heartbeat = 30
		params.socket_timeout = 10
		params.stack_timeout = 30          # la conexión TLS a CloudAMQP a veces tarda más de los 15 s por defecto
		params.connection_attempts = 3
		params.retry_delay = 2
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

	def llamar(self, cola: str, payload: dict | None = None, timeout: int = 10, token: str | None = None) -> dict:
		self.respuesta = None
		self.corr_id = str(uuid.uuid4())
		self.channel.basic_publish(
			exchange="",
			routing_key=cola,
			properties=pika.BasicProperties(
				reply_to=self.cola_respuesta,
				correlation_id=self.corr_id,
				expiration=str(timeout * 1000),
				headers={"Authorization": f"Bearer {token}"} if token else None,
			),
			body=json.dumps(payload).encode() if payload is not None else b"",
		)
		limite = time.monotonic() + timeout
		while self.respuesta is None and time.monotonic() < limite:
			self.connection.process_data_events(time_limit=1)
		if self.respuesta is None:
			raise SinRespuesta("El worker de Clientes no respondió a tiempo")
		return self.respuesta

	def cerrar(self):
		self.connection.close()


def _token(rpc: ClienteRPC, login: tuple, renovar: bool = False) -> str:
	"""Token guardado para ese login, o uno nuevo pedido a su cola de login (se renueva 1 min antes de vencer)."""
	cola_login, prefijo, grupo = login
	with _candado_tokens:
		guardado = _tokens.get(cola_login)
		if guardado and not renovar and time.monotonic() < guardado[1]:
			return guardado[0]
		usuario, password = os.getenv(f"{prefijo}_USUARIO", ""), os.getenv(f"{prefijo}_PASSWORD", "")
		if not usuario or not password:
			raise ClientesError(401, f"Faltan {prefijo}_USUARIO y {prefijo}_PASSWORD en el .env (la cuenta la entrega {grupo})")
		respuesta = rpc.llamar(cola_login, {"usuario": usuario, "password": password})
		if respuesta.get("status") != 200:
			raise ClientesError(401, f"{grupo} rechazó el usuario '{usuario}' de Reportes: {respuesta.get('error', 'credenciales inválidas')}")
		datos = respuesta["data"]
		vida = int(datos.get("expira_en_segundos", 1800))
		_tokens[cola_login] = (datos["token"], time.monotonic() + max(vida - 60, 30))
		return datos["token"]


def _llamar(cola: str, payload: dict | None = None, servicio: str = "Clientes"):
	login = LOGIN_POR_COLA.get(cola)
	try:
		rpc = ClienteRPC()
		try:
			token = _token(rpc, login) if login else None
			respuesta = rpc.llamar(cola, payload, token=token)
			if login and respuesta.get("status") == 401:     # token vencido o revocado: login de nuevo, una vez
				respuesta = rpc.llamar(cola, payload, token=_token(rpc, login, renovar=True))
		finally:
			rpc.cerrar()
	except ClientesError:
		raise
	except SinRespuesta:
		raise ClientesError(502, f"RabbitMQ conectó, pero el worker de {servicio} no respondió. ¿Está corriendo su worker.py?")
	except Exception as e:                 # pika (AMQPError, AMQPConnectorException...), sockets, TLS...
		raise ClientesError(502, f"No se pudo conectar con RabbitMQ ({type(e).__name__}). Revisa tu internet y AMQP_URL")
	if respuesta.get("status") != 200:
		raise ClientesError(respuesta.get("status", 500), respuesta.get("error", f"Error en {servicio}"))
	return respuesta["data"]


def consultar_cliente(cliente_id: int) -> dict:
	return _llamar(COLA_CLIENTE, {"id": cliente_id})


def listar_clientes() -> list:
	return _llamar(COLA_CLIENTES)


def listar_productos() -> list:
	return _llamar(COLA_PRODUCTOS, None, "Productos")


def consultar_producto(producto_id: int) -> dict:
	return _llamar(COLA_PRODUCTO, {"id": producto_id}, "Productos")


def listar_pedidos() -> list:
	return _llamar(COLA_PEDIDOS, None, "Pedidos")


def listar_inventario() -> list:
	return _llamar(COLA_INVENTARIO_LISTAR, None, "Inventario")


if __name__ == "__main__":
	try:
		if len(sys.argv) > 1:
			resultado = consultar_cliente(int(sys.argv[1]))
		else:
			resultado = listar_clientes()
		print(json.dumps(resultado, indent=2, ensure_ascii=False, default=str))
	except ClientesError as e:
		print(f"Error {e.status}: {e.detalle}")
