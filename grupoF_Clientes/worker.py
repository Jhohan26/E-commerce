import hmac
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

import jwt
import pika
import pymysql
from dotenv import load_dotenv

load_dotenv()

from main import CAMPOS_PUBLICOS, DB_CONFIG

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker")

CLOUDAMQP_URL = os.environ["CLOUDAMQP_URL"]
COLA_LOGIN = "auth.login"
COLA_CLIENTE = "cliente.consultar"
COLA_CLIENTES = "clientes.listar"

JWT_SECRET = os.environ.get("JWT_SECRET", "es_un_secreto_de_tu_mirada_y_la_mia,_un_presentimiento,_como_un_angel_que_me_decia")
JWT_ALGORITMO = "HS256"
JWT_EXPIRA_MINUTOS = int(os.environ.get("JWT_EXPIRA_MINUTOS", "30"))
ARCHIVO_USUARIOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "usuarios.json")


class NoAutorizado(Exception):
	pass


def cargar_usuarios() -> dict:
	with open(ARCHIVO_USUARIOS, encoding="utf-8") as f:
		return json.load(f)


def login(cuerpo: bytes, usuario: str | None = None) -> dict:
	try:
		datos = json.loads(cuerpo)
		nombre = str(datos["usuario"])
		password = str(datos["password"])
	except (ValueError, KeyError, TypeError):
		return {"status": 400, "error": 'Se espera un JSON como {"usuario": "...", "password": "..."}'}

	esperado = cargar_usuarios().get(nombre)
	if esperado is None or not hmac.compare_digest(str(esperado).encode(), password.encode()):
		return {"status": 401, "error": "Credenciales inválidas"}

	ahora = datetime.now(timezone.utc)
	token = jwt.encode(
		{"sub": nombre, "iat": ahora, "exp": ahora + timedelta(minutes=JWT_EXPIRA_MINUTOS)},
		JWT_SECRET,
		algorithm=JWT_ALGORITMO,
	)
	return {
		"status": 200,
		"data": {"token": token, "tipo": "Bearer", "expira_en_segundos": JWT_EXPIRA_MINUTOS * 60},
	}


def extraer_token(props, cuerpo: bytes) -> str:
	headers = props.headers or {}
	auth = headers.get("Authorization") or headers.get("authorization")
	if auth:
		return auth.removeprefix("Bearer ").strip()
	try:
		token = json.loads(cuerpo).get("token")
	except (ValueError, AttributeError):
		token = None
	if not token:
		raise NoAutorizado("Falta el token")
	return str(token)


def verificar_token(props, cuerpo: bytes) -> str:
	token = extraer_token(props, cuerpo)
	try:
		payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITMO])
	except jwt.ExpiredSignatureError:
		raise NoAutorizado("Token expirado")
	except jwt.InvalidTokenError:
		raise NoAutorizado("Token inválido")
	return payload["sub"]


def consultar_cliente(cuerpo: bytes, usuario: str | None = None) -> dict:
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


def listar_clientes(cuerpo: bytes, usuario: str | None = None) -> dict:
	conn = pymysql.connect(**DB_CONFIG)
	try:
		with conn.cursor() as cur:
			cur.execute(f"SELECT {CAMPOS_PUBLICOS} FROM Cliente ORDER BY id")
			filas = cur.fetchall()
	finally:
		conn.close()
	return {"status": 200, "data": filas}


def crear_callback(funcion, requiere_auth: bool = True):
	def callback(ch, method, props, body):
		try:
			usuario = verificar_token(props, body) if requiere_auth else None
			if usuario:
				log.info("%s -> %s", usuario, funcion.__name__)
			respuesta = funcion(body, usuario)
		except NoAutorizado as e:
			respuesta = {"status": 401, "error": str(e)}
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
				body=json.dumps(respuesta, ensure_ascii=False, default=str).encode(),
			)
		ch.basic_ack(delivery_tag=method.delivery_tag)

	return callback


def ejecutar():
	params = pika.URLParameters(CLOUDAMQP_URL)
	params.heartbeat = 30
	connection = pika.BlockingConnection(params)
	channel = connection.channel()
	channel.basic_qos(prefetch_count=1)

	colas = (
		(COLA_LOGIN, login, False),  # única cola pública
		(COLA_CLIENTE, consultar_cliente, True),
		(COLA_CLIENTES, listar_clientes, True),
	)
	for cola, funcion, requiere_auth in colas:
		channel.queue_declare(queue=cola, durable=True)
		channel.basic_consume(queue=cola, on_message_callback=crear_callback(funcion, requiere_auth))

	log.info("Worker listo. Escuchando: %s", ", ".join(c[0] for c in colas))
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
