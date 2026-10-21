import hmac
import json
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import jwt
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
COLA_LOGIN = "productos.login"
COLA_PRODUCTO = "producto.consultar"
COLA_PRODUCTOS = "productos.listar"

# Credenciales de un único usuario, configuradas en el archivo .env
AUTH_USUARIO = os.environ.get("AUTH_USUARIO", "")
AUTH_PASSWORD = os.environ.get("AUTH_PASSWORD", "")
JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALGORITMO = "HS256"
JWT_EXPIRA_MINUTOS = int(os.environ.get("JWT_EXPIRA_MINUTOS", "30"))


class NoAutorizado(Exception):
    pass


def login(cuerpo: bytes, usuario: str | None = None) -> dict:
    try:
        datos = json.loads(cuerpo)
        nombre = str(datos["usuario"])
        password = str(datos["password"])
    except (ValueError, KeyError, TypeError):
        return {"status": 400, "error": 'Se espera un JSON como {"usuario": "...", "password": "..."}'}

    # No se permite autenticar si las credenciales o el secreto no están configurados.
    if not AUTH_USUARIO or not AUTH_PASSWORD or not JWT_SECRET:
        log.error("Faltan AUTH_USUARIO, AUTH_PASSWORD o JWT_SECRET en el .env")
        return {"status": 500, "error": "Autenticación no configurada"}

    usuario_valido = hmac.compare_digest(nombre.encode(), AUTH_USUARIO.encode())
    password_valido = hmac.compare_digest(password.encode(), AUTH_PASSWORD.encode())
    if not (usuario_valido and password_valido):
        return {"status": 401, "error": "Credenciales inválidas"}

    ahora = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "sub": AUTH_USUARIO,
            "iat": ahora,
            "exp": ahora + timedelta(minutes=JWT_EXPIRA_MINUTOS),
        },
        JWT_SECRET,
        algorithm=JWT_ALGORITMO,
    )
    return {
        "status": 200,
        "data": {
            "token": token,
            "tipo": "Bearer",
            "expira_en_segundos": JWT_EXPIRA_MINUTOS * 60,
        },
    }


def extraer_token(props, cuerpo: bytes) -> str:
    headers = props.headers or {}
    auth = headers.get("Authorization") or headers.get("authorization")
    if auth:
        esquema, separador, credencial = str(auth).partition(" ")
        if separador and esquema.lower() == "bearer" and credencial.strip():
            return credencial.strip()
        raise NoAutorizado("Cabecera Authorization inválida")

    try:
        token = json.loads(cuerpo).get("token")
    except (ValueError, AttributeError, TypeError):
        token = None
    if not token:
        raise NoAutorizado("Falta el token")
    return str(token)


def verificar_token(props, cuerpo: bytes) -> str:
    if not JWT_SECRET:
        log.error("Falta JWT_SECRET en el .env")
        raise NoAutorizado("Autenticación no configurada")

    token = extraer_token(props, cuerpo)
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITMO])
    except jwt.ExpiredSignatureError:
        raise NoAutorizado("Token expirado")
    except jwt.InvalidTokenError:
        raise NoAutorizado("Token inválido")

    usuario = payload.get("sub")
    if not usuario or usuario != AUTH_USUARIO:
        raise NoAutorizado("Token inválido")
    return str(usuario)



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


def consultar_producto(cuerpo: bytes, usuario: str | None = None) -> dict:
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


def listar_productos(cuerpo: bytes, usuario: str | None = None) -> dict:
    conn = pymysql.connect(**DB_CONFIG)
    try:
        with conn.cursor() as cur:
            cur.execute(SELECT_PRODUCTOS + " ORDER BY p.id")
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

    colas = (
        (COLA_LOGIN, login, False),
        (COLA_PRODUCTO, consultar_producto, True),
        (COLA_PRODUCTOS, listar_productos, True),
    )
    for cola, funcion, requiere_auth in colas:
        channel.queue_declare(queue=cola, durable=True)
        channel.basic_consume(
            queue=cola,
            on_message_callback=crear_callback(funcion, requiere_auth),
        )

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
