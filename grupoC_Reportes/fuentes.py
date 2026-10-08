"""Conexiones de Reportes con los otros microservicios.

- Clientes: RabbitMQ RPC (cliente_rpc.py) o, sin AMQP_URL, HTTP.
- Pedidos, Productos, Inventario: APIs REST (al arrancar, al pulsar Actualizar y como respaldo).
- Eventos (PedidoCreado, PagoAprobado, PagoRechazado, InventarioActualizado): hilo consumidor de RabbitMQ.
Todo lo recibido se guarda en `almacen` (memoria), que avisa al dashboard.

Cada servicio tiene su propio estado en `estado` (ok / error / sin_configurar / pendiente) con el MOTIVO,
para que el dashboard explique qué está fallando. Ningún error de red debe matar un hilo.
"""
import json
import logging
import os
import threading
import time

import pika
import requests
from dotenv import load_dotenv

import almacen
import cliente_rpc

load_dotenv()

AMQP_URL = os.getenv("AMQP_URL", "")
CLIENTES_URL = os.getenv("CLIENTES_URL", "http://localhost:8000")
PEDIDOS_URL = os.getenv("PEDIDOS_URL", "http://localhost:3000").rstrip("/")
PRODUCTOS_URL = os.getenv("PRODUCTOS_URL", "").rstrip("/")    # sin valor por defecto: no se adivina el puerto
INVENTARIO_URL = os.getenv("INVENTARIO_URL", "").rstrip("/")  # idem (el README de Inventario sugiere el puerto 8005)
CLIENTES_RPC = os.getenv("CLIENTES_MODO", "rpc" if AMQP_URL else "http") == "rpc"
# Clientes no publica eventos: este respaldo vuelve a pedirle sus datos cada N segundos (0 = apagado).
REFRESCO_SEG = int(os.getenv("REFRESCO_SEG", "300"))

EXCHANGE_PEDIDOS = os.getenv("AMQP_EXCHANGE_PEDIDOS", "pedidos_exchange")
COLA_PEDIDOS = os.getenv("AMQP_QUEUE_PEDIDOS", "reportes_pedidos_queue")
COLA_PAGOS = os.getenv("AMQP_QUEUE_PAGOS", "reportes_pagos_queue")
COLA_INVENTARIO = os.getenv("AMQP_QUEUE_INVENTARIO", "reportes_inventario_queue")
EXCHANGE_INVENTARIO = os.getenv("AMQP_EXCHANGE_INVENTARIO", "inventario_exchange")   # fanout, lo declara Inventario
# Pagos usa ecommerce.eventos (topic); Facturación espera pagos_exchange (fanout). Se enlaza al que exista.
EXCHANGES_PAGOS = [x.strip() for x in os.getenv("AMQP_EXCHANGES_PAGOS", "ecommerce.eventos,pagos_exchange").split(",") if x.strip()]
CLAVES_PAGOS = ("pago.aprobado", "pago.rechazado")  # las ignora un exchange fanout

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logging.getLogger("pika").setLevel(logging.CRITICAL)   # los errores de pika se explican en el estado y en nuestros mensajes
log = logging.getLogger("reportes")


# ---------- estado de cada servicio (lo muestra el dashboard) ----------
def _nuevo(etiqueta: str, via: str) -> dict:
	return dict(etiqueta=etiqueta, via=via, estado="pendiente", detalle="", cantidad=None, hora=None)


estado = {
	"clientes": _nuevo("Clientes", "RabbitMQ · worker de Clientes" if CLIENTES_RPC else CLIENTES_URL),
	"pedidos": _nuevo("Pedidos (API)", PEDIDOS_URL),
	"rabbit": _nuevo("Pedidos y pagos en vivo", "RabbitMQ"),
	"productos": _nuevo("Productos (API)", PRODUCTOS_URL or "sin dirección"),
	"inventario": _nuevo("Inventario (API)", INVENTARIO_URL or "sin dirección"),
}
for _clave, _var, _url in (("productos", "PRODUCTOS_URL", PRODUCTOS_URL), ("inventario", "INVENTARIO_URL", INVENTARIO_URL)):
	if not _url:
		estado[_clave].update(estado="sin_configurar", detalle=f"Falta poner la dirección del servicio en {_var} del archivo .env")
if not AMQP_URL:
	estado["rabbit"].update(estado="sin_configurar", detalle="Falta AMQP_URL en el archivo .env")
	if CLIENTES_RPC:
		estado["clientes"].update(estado="sin_configurar", detalle="Falta AMQP_URL en el archivo .env")

_enlazados: set = set()


class FuenteError(Exception):
	def __init__(self, status: int, detalle: str):
		super().__init__(detalle)
		self.status, self.detalle = status, detalle


def _estado(clave: str, valor: str, detalle: str = "", cantidad=None):
	e = estado[clave]
	cambio = (e["estado"], e["detalle"], e["cantidad"]) != (valor, detalle, cantidad)
	e.update(estado=valor, detalle=detalle, cantidad=cantidad, hora=time.strftime("%H:%M:%S"))
	if cambio:
		almacen.al_cambiar()


def _motivo(e: Exception, url: str, nombre: str) -> str:
	"""Explica en español por qué falló una llamada, para mostrarlo en el dashboard."""
	if isinstance(e, requests.Timeout) and not isinstance(e, requests.ConnectionError):
		return f"{nombre} tardó demasiado en responder ({url})"
	if isinstance(e, requests.ConnectionError):
		return f"No responde en {url}. ¿Está encendido el servicio de {nombre} y es correcta la dirección?"
	if isinstance(e, requests.HTTPError):
		return f"{nombre} respondió con error {e.response.status_code} en {url}"
	if isinstance(e, (ValueError, KeyError, TypeError, AttributeError)):
		return f"{nombre} respondió con un formato que Reportes no entiende ({type(e).__name__})"
	return f"Error inesperado al consultar {nombre}: {type(e).__name__}"


# ---------- Clientes ----------
def traer_cliente(cliente_id: int) -> dict:
	"""Consulta un cliente a Clientes (contrato: {"id": N} -> datos del cliente)."""
	if CLIENTES_RPC:
		try:
			return cliente_rpc.consultar_cliente(cliente_id)
		except cliente_rpc.ClientesError as e:
			raise FuenteError(404 if e.status == 404 else 502, e.detalle if e.status != 404 else "Cliente no encontrado")
	try:
		r = requests.post(f"{CLIENTES_URL}/cliente", json={"id": cliente_id}, timeout=5)
	except requests.RequestException:
		raise FuenteError(502, "No se pudo contactar al servicio de Clientes")
	if r.status_code == 404:
		raise FuenteError(404, "Cliente no encontrado")
	if r.status_code != 200:
		raise FuenteError(502, f"Clientes respondió {r.status_code}")
	return r.json()


def cargar_clientes() -> int:
	try:
		if CLIENTES_RPC:
			lista = cliente_rpc.listar_clientes()
		else:
			r = requests.get(f"{CLIENTES_URL}/clientes", timeout=10)
			r.raise_for_status()
			lista = r.json()
		almacen.reemplazar_clientes(lista)
	except cliente_rpc.ClientesError as e:
		_estado("clientes", "error", e.detalle)
		raise FuenteError(502, e.detalle)
	except Exception as e:
		d = _motivo(e, CLIENTES_URL, "Clientes")
		_estado("clientes", "error", d)
		raise FuenteError(502, d)
	_estado("clientes", "ok", cantidad=len(lista))
	return len(lista)


# ---------- APIs REST: Pedidos, Productos, Inventario ----------
def _cargar_rest(clave: str, base: str, ruta: str, guardar, nombre: str, variable: str) -> int:
	if not base:
		raise FuenteError(503, f"Falta poner la dirección en {variable} del archivo .env")
	try:
		r = requests.get(f"{base}{ruta}", timeout=10)
		r.raise_for_status()
		lista = r.json()
		guardar(lista)
	except Exception as e:
		d = _motivo(e, base, nombre)
		_estado(clave, "error", d)
		raise FuenteError(502, d)
	_estado(clave, "ok", cantidad=len(lista))
	return len(lista)


def cargar_pedidos() -> int:
	"""GET /api/pedidos y, por cada pedido, GET /api/pedidos/{id} (trae los productos)."""
	try:
		r = requests.get(f"{PEDIDOS_URL}/api/pedidos", timeout=10)
		r.raise_for_status()
		datos = r.json()
		lista = datos if isinstance(datos, list) else datos.get("pedidos", [])
		for resumen in lista:
			r = requests.get(f"{PEDIDOS_URL}/api/pedidos/{resumen['id']}", timeout=10)
			r.raise_for_status()
			d = r.json()
			p = d.get("pedido", d)
			almacen.guardar_pedido(dict(pedidoId=p["id"], clienteId=p["clienteId"], fecha=p["fecha"],
										total=p["total"], productos=p.get("productos", [])), p.get("estado"))
	except Exception as e:
		d = _motivo(e, PEDIDOS_URL, "Pedidos")
		_estado("pedidos", "error", d)
		raise FuenteError(502, d)
	_estado("pedidos", "ok", cantidad=len(lista))
	return len(lista)


def cargar_productos() -> int:
	"""GET {PRODUCTOS_URL}/api/productos -> catálogo (id, nombre, categoria, precio)."""
	return _cargar_rest("productos", PRODUCTOS_URL, "/api/productos", almacen.reemplazar_productos, "Productos", "PRODUCTOS_URL")


def cargar_inventario() -> int:
	"""GET {INVENTARIO_URL}/api/inventario -> existencias por producto."""
	return _cargar_rest("inventario", INVENTARIO_URL, "/api/inventario", almacen.reemplazar_inventario, "Inventario", "INVENTARIO_URL")


def refrescar_todo() -> dict:
	"""Vuelve a pedir todo a las APIs. Nunca lanza error: devuelve cuántos datos trajo de cada fuente o el motivo."""
	res = {}
	for nombre, f in (("clientes", cargar_clientes), ("pedidos", cargar_pedidos), ("productos", cargar_productos),
					  ("inventario", cargar_inventario)):
		try:
			res[nombre] = f()
		except FuenteError as e:
			res[nombre] = e.detalle
		except Exception as e:                       # lo inesperado también se explica, no se propaga
			log.exception("Error inesperado al refrescar %s", nombre)
			_estado(nombre, "error", f"Error inesperado: {type(e).__name__}")
			res[nombre] = f"Error inesperado: {type(e).__name__}"
	return res


# ---------- Eventos ----------
_ultimo_intento_productos = 0.0


def aplicar_evento(d: dict) -> None:
	"""PedidoCreado / PagoAprobado / PagoRechazado / evento de inventario. ValueError si el mensaje no sirve."""
	global _ultimo_intento_productos
	try:
		ev, pid = d["evento"], int(d["pedidoId"])
		if ev == "PedidoCreado":
			almacen.guardar_pedido(dict(d, pedidoId=pid, clienteId=int(d["clienteId"])))
			if int(d["clienteId"]) not in almacen.clientes:      # cliente nuevo: se pide a Clientes
				try:
					almacen.guardar_cliente(traer_cliente(int(d["clienteId"])))
				except FuenteError:
					pass
			desconocido = any(x["productoId"] not in almacen.productos for x in d.get("productos", []))
			if PRODUCTOS_URL and desconocido and time.time() - _ultimo_intento_productos > 60:
				_ultimo_intento_productos = time.time()           # producto desconocido: se relee el catálogo (máx. 1 vez/min)
				try:
					cargar_productos()
				except FuenteError:
					pass
		elif ev in ("PagoAprobado", "PagoRechazado"):
			almacen.registrar_pago(pid, ev == "PagoAprobado")
		elif ev in ("InventarioActualizado", "InventarioInsuficiente"):
			# el evento solo avisa que el stock cambió: se vuelve a leer la API de Inventario
			if INVENTARIO_URL:
				try:
					cargar_inventario()
				except FuenteError:
					pass
		else:
			raise ValueError("Evento no soportado por Reportes: " + str(ev))
	except (KeyError, TypeError) as e:
		raise ValueError("Campo faltante o inválido: " + str(e))


# ---------- RabbitMQ en vivo ----------
# cola propia -> (exchanges candidatos, claves de enlace). Solo se enlazan los que YA existen: no se crean.
_ENLACES = {COLA_PAGOS: (EXCHANGES_PAGOS, CLAVES_PAGOS),
			COLA_INVENTARIO: ([EXCHANGE_INVENTARIO], ("",))}


def _detalle_rabbit() -> str:
	pagos = any((COLA_PAGOS, ex) in _enlazados for ex in EXCHANGES_PAGOS)
	inv = (COLA_INVENTARIO, EXCHANGE_INVENTARIO) in _enlazados
	return ("Escuchando pedidos · "
			+ ("pagos enlazados" if pagos else "pagos: esperando que el grupo de Pagos cree su exchange") + " · "
			+ ("inventario enlazado" if inv else "inventario: esperando que ese grupo cree su exchange"))


def _enlazar_opcionales(conn):
	"""Enlaza las colas de pagos e inventario a los exchanges de esos grupos cuando existan; reintenta cada 30 s."""
	pendientes = 0
	for cola, (exchanges, claves) in _ENLACES.items():
		for ex in exchanges:
			if (cola, ex) in _enlazados:
				continue
			ch = conn.channel()
			try:
				ch.exchange_declare(exchange=ex, passive=True)   # solo comprueba, no crea
				for clave in claves:
					ch.queue_bind(queue=cola, exchange=ex, routing_key=clave)
				_enlazados.add((cola, ex))
				log.info("Cola '%s' enlazada a '%s'", cola, ex)
			except pika.exceptions.ChannelClosedByBroker:
				pendientes += 1   # aún no existe
			else:
				ch.close()
	_estado("rabbit", "ok", _detalle_rabbit())
	if pendientes:
		conn.call_later(30, lambda: _enlazar_opcionales(conn))


def _al_recibir(ch, method, props, body):
	try:
		d = json.loads(body)
		aplicar_evento(d)
		log.info("%s del pedido %s", d["evento"], d["pedidoId"])
		ch.basic_ack(method.delivery_tag)
	except ValueError as err:                 # JSON inválido o evento ajeno: se descarta
		log.warning("Mensaje descartado: %s", str(err)[:120])
		ch.basic_nack(method.delivery_tag, requeue=False)
	except Exception as err:                  # algo inesperado: se reintenta, no se pierde
		log.error("Error procesando el evento, se reintenta: %s", err)
		time.sleep(5)
		ch.basic_nack(method.delivery_tag, requeue=True)


def _parametros() -> pika.URLParameters:
	p = pika.URLParameters(AMQP_URL)
	p.heartbeat = 30
	p.socket_timeout = 10
	p.stack_timeout = 30          # conexiones lentas (TLS a CloudAMQP) no se cortan a los 15 s por defecto
	p.connection_attempts = 3
	p.retry_delay = 2
	return p


def _escuchar():
	conn = pika.BlockingConnection(_parametros())
	ch = conn.channel()
	ch.exchange_declare(exchange=EXCHANGE_PEDIDOS, exchange_type="fanout", durable=True)
	ch.queue_declare(queue=COLA_PEDIDOS, durable=True)
	ch.queue_bind(queue=COLA_PEDIDOS, exchange=EXCHANGE_PEDIDOS)
	ch.queue_declare(queue=COLA_PAGOS, durable=True)
	ch.queue_declare(queue=COLA_INVENTARIO, durable=True)
	_enlazar_opcionales(conn)
	ch.basic_qos(prefetch_count=1)
	ch.basic_consume(queue=COLA_PEDIDOS, on_message_callback=_al_recibir)
	ch.basic_consume(queue=COLA_PAGOS, on_message_callback=_al_recibir)
	ch.basic_consume(queue=COLA_INVENTARIO, on_message_callback=_al_recibir)
	log.info("Escuchando '%s', '%s' y '%s'", COLA_PEDIDOS, COLA_PAGOS, COLA_INVENTARIO)
	ch.start_consuming()


def _bucle_rabbit():
	"""Mantiene la conexión con RabbitMQ para siempre: cualquier fallo se explica en el estado y se reintenta."""
	espera = 5
	while True:
		try:
			_escuchar()
			espera = 5
		except Exception as err:
			_enlazados.clear()
			motivo = f"No se pudo conectar con RabbitMQ ({type(err).__name__}). Reintentando en {espera} s"
			_estado("rabbit", "error", motivo)
			log.error(motivo)
			time.sleep(espera)
			espera = min(espera * 2, 60)


def _bucle_refresco():
	while True:
		time.sleep(REFRESCO_SEG)
		try:
			refrescar_todo()
		except Exception:
			log.exception("Falló el refresco periódico")


def arrancar():
	"""Se llama una vez al iniciar la API (en un hilo aparte). Nada de lo que pase aquí detiene a la API."""
	try:
		if AMQP_URL:
			threading.Thread(target=_bucle_rabbit, daemon=True).start()
		refrescar_todo()
		if REFRESCO_SEG > 0:
			threading.Thread(target=_bucle_refresco, daemon=True).start()
	except Exception:
		log.exception("Error al arrancar las conexiones")
