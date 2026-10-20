"""Worker RPC de Inventario (RabbitMQ / CloudAMQP) con autenticación JWT.

Colas:
    inventario.login      (pública)   {"usuario": "...", "password": "..."}  -> token
    inventario.consultar  (con token) {"id": 15}  (también acepta "producto_id")
    inventario.listar     (con token) cuerpo vacío o {}

El token se envía en el header AMQP "Authorization: Bearer <token>"
(o, como alternativa, en el cuerpo JSON como {"token": "..."}).

Respuesta (JSON):
    {"status": 200, "data": ...}
    {"status": 400 | 401 | 404 | 500, "error": "..."}

Variables de entorno: RABBITMQ_URL (o CLOUDAMQP_URL), JWT_SECRET,
JWT_EXPIRA_MINUTOS (opcional, por defecto 30).
Usuarios: archivo usuarios.json junto a este script.

Ubicación: raíz del proyecto (junto a la carpeta app/).
Uso:       python worker_inventario.py
"""
import hmac
import json
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import jwt
import pika
from dotenv import load_dotenv

load_dotenv()

from app.db import get_conn  # reutiliza la conexión del proyecto (DictCursor)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker_inventario")

# Misma variable que el resto del proyecto; CLOUDAMQP_URL como alternativa
RABBITMQ_URL = os.getenv("RABBITMQ_URL") or os.environ["CLOUDAMQP_URL"]
COLA_LOGIN = "inventario.login"
COLA_PRODUCTO = "inventario.consultar"
COLA_INVENTARIO = "inventario.listar"
COLUMNAS = "producto_id, nombre, cantidad, actualizado"

JWT_SECRET = os.environ["JWT_SECRET"]  # sin valor por defecto: no dejar secretos en el código
JWT_ALGORITMO = "HS256"
JWT_EXPIRA_MINUTOS = int(os.environ.get("JWT_EXPIRA_MINUTOS", "30"))
ARCHIVO_USUARIOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "usuarios.json")


class NoAutorizado(Exception):
    pass


# ---------- autenticación ----------
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


# ---------- funciones de inventario ----------
def _serializar(obj):
    """Permite json.dumps con los datetime/Decimal que devuelve MySQL."""
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"No serializable: {type(obj)}")


def consultar_producto(cuerpo: bytes, usuario: str | None = None) -> dict:
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


def listar_inventario(cuerpo: bytes, usuario: str | None = None) -> dict:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT {COLUMNAS} FROM Inventario ORDER BY producto_id")
            filas = cur.fetchall()
    finally:
        conn.close()
    return {"status": 200, "data": filas}


# ---------- RabbitMQ ----------
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

    colas = (
        (COLA_LOGIN, login, False),  # única cola pública
        (COLA_PRODUCTO, consultar_producto, True),
        (COLA_INVENTARIO, listar_inventario, True),
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
