"""Cliente RPC del microservicio de Productos (RabbitMQ).

Pide el catálogo a la cola `productos.listar` y espera la respuesta en una cola
exclusiva (patrón reply_to + correlation_id). Es seguro entre hilos: FastAPI
atiende cada petición en un hilo distinto y aquí se serializan las llamadas.
"""
import json
import logging
import os
import threading
import time
import uuid

import pika
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("inventario.productos")

# El módulo de Productos vive en OTRA instancia de CloudAMQP: no reutilices RABBITMQ_URL
# a menos que sea la misma. Si no defines PRODUCTOS_RABBITMQ_URL se usa RABBITMQ_URL.
URL = os.getenv("PRODUCTOS_RABBITMQ_URL") or os.getenv("RABBITMQ_URL", "")
COLA_LISTAR = os.getenv("PRODUCTOS_COLA_LISTAR", "productos.listar")
COLA_CONSULTAR = os.getenv("PRODUCTOS_COLA_CONSULTAR", "producto.consultar")
TIMEOUT = int(os.getenv("PRODUCTOS_RPC_TIMEOUT", "8"))
CACHE_SEG = int(os.getenv("PRODUCTOS_CACHE_SEG", "10"))

_CLAVES_LISTA = ("productos", "data", "items", "resultados", "results")
_CLAVES_ID = ("id", "producto_id", "productoId", "idProducto", "id_producto")
_CLAVES_NOMBRE = ("nombre", "name", "titulo", "descripcion")
_CLAVES_PRECIO = ("precio", "price", "valor")


class ProductosError(Exception):
    """El módulo de Productos no respondió o devolvió algo inesperado."""


def _primero(d: dict, claves: tuple):
    for k in claves:
        if d.get(k) is not None:
            return d[k]
    return None


def normalizar(respuesta) -> list[dict]:
    """Convierte la respuesta del RPC en [{producto_id, nombre, precio, detalle}]."""
    if isinstance(respuesta, dict):
        if respuesta.get("error"):
            raise ProductosError(str(respuesta["error"]))
        for k in _CLAVES_LISTA:
            if isinstance(respuesta.get(k), list):
                respuesta = respuesta[k]
                break
        else:
            raise ProductosError(f"Formato inesperado, claves: {list(respuesta)[:6]}")
    if not isinstance(respuesta, list):
        raise ProductosError("La respuesta de Productos no es una lista")

    salida = []
    for p in respuesta:
        if not isinstance(p, dict):
            continue
        try:
            pid = int(_primero(p, _CLAVES_ID))
        except (TypeError, ValueError):
            continue
        salida.append(
            {
                "producto_id": pid,
                "nombre": _primero(p, _CLAVES_NOMBRE),
                "precio": _primero(p, _CLAVES_PRECIO),
                "detalle": p,  # respuesta original, por si se necesitan más campos
            }
        )
    return salida


class ClienteProductos:
    def __init__(self):
        self._lock = threading.Lock()
        self._conn = None
        self._canal = None
        self._cola_resp = None
        self._corr_id = None
        self._respuesta = None
        self._cache: list[dict] | None = None
        self._cache_hasta = 0.0

    # ---------- conexión ----------
    def _conectar(self):
        if not URL:
            raise ProductosError("Falta PRODUCTOS_RABBITMQ_URL en el .env")
        params = pika.URLParameters(URL)
        params.heartbeat = 30
        params.socket_timeout = 5
        self._conn = pika.BlockingConnection(params)
        self._canal = self._conn.channel()
        self._cola_resp = self._canal.queue_declare(queue="", exclusive=True).method.queue
        self._canal.basic_consume(self._cola_resp, self._on_response, auto_ack=True)

    def _on_response(self, ch, method, props, body):
        if props.correlation_id == self._corr_id:
            self._respuesta = json.loads(body)

    def cerrar(self):
        with self._lock:
            self._desconectar()

    def _desconectar(self):
        try:
            if self._conn and self._conn.is_open:
                self._conn.close()
        except Exception:
            pass
        self._conn = self._canal = None

    # ---------- RPC ----------
    def _llamar_una_vez(self, cola: str, payload: dict | None):
        if not self._conn or self._conn.is_closed:
            self._conectar()
        self._respuesta = None
        self._corr_id = str(uuid.uuid4())
        self._canal.basic_publish(
            exchange="",
            routing_key=cola,
            properties=pika.BasicProperties(
                reply_to=self._cola_resp,
                correlation_id=self._corr_id,
                expiration=str(TIMEOUT * 1000),
            ),
            body=json.dumps(payload).encode() if payload is not None else b"",
        )
        limite = time.monotonic() + TIMEOUT
        while self._respuesta is None and time.monotonic() < limite:
            self._conn.process_data_events(time_limit=1)
        if self._respuesta is None:
            raise TimeoutError("El módulo de Productos no respondió a tiempo")
        return self._respuesta

    def llamar(self, cola: str, payload: dict | None = None):
        with self._lock:
            try:
                return self._llamar_una_vez(cola, payload)
            except pika.exceptions.AMQPError as e:
                # Conexión caída (p. ej. cerrada por inactividad): reconectar y reintentar una vez
                log.warning("Conexión con Productos perdida (%s); reconectando", e)
                self._desconectar()
                return self._llamar_una_vez(cola, payload)

    # ---------- API de alto nivel ----------
    def listar(self) -> list[dict]:
        """Catálogo completo, con caché corta para no saturar al otro grupo."""
        ahora = time.monotonic()
        if self._cache is not None and ahora < self._cache_hasta:
            return self._cache
        try:
            catalogo = normalizar(self.llamar(COLA_LISTAR))
        except ProductosError:
            raise
        except Exception as e:  # red, timeout, JSON inválido...
            raise ProductosError(str(e) or e.__class__.__name__) from e
        self._cache, self._cache_hasta = catalogo, ahora + CACHE_SEG
        return catalogo
