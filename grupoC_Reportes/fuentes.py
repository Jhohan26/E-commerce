"""Conexiones de Reportes con los otros microservicios.

- Clientes: RabbitMQ RPC (cliente_rpc.py) o, sin AMQP_URL, HTTP.
- Pedidos: API REST al arrancar y como respaldo; en tiempo real por eventos.
- Eventos (PedidoCreado, PagoAprobado, PagoRechazado): hilo consumidor de RabbitMQ.
Todo lo recibido se guarda en `almacen` (memoria), que avisa al dashboard.
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
PEDIDOS_URL = os.getenv("PEDIDOS_URL", "http://localhost:3000")
CLIENTES_RPC = os.getenv("CLIENTES_MODO", "rpc" if AMQP_URL else "http") == "rpc"
# Clientes no publica eventos: este respaldo vuelve a pedirle sus datos cada N segundos (0 = apagado).
REFRESCO_SEG = int(os.getenv("REFRESCO_SEG", "300"))

EXCHANGE_PEDIDOS = os.getenv("AMQP_EXCHANGE_PEDIDOS", "pedidos_exchange")
COLA_PEDIDOS = os.getenv("AMQP_QUEUE_PEDIDOS", "reportes_pedidos_queue")
COLA_PAGOS = os.getenv("AMQP_QUEUE_PAGOS", "reportes_pagos_queue")
# Pagos usa ecommerce.eventos (topic); Facturación espera pagos_exchange (fanout). Se enlaza al que exista.
EXCHANGES_PAGOS = [x.strip() for x in os.getenv("AMQP_EXCHANGES_PAGOS", "ecommerce.eventos,pagos_exchange").split(",") if x.strip()]
CLAVES_PAGOS = ("pago.aprobado", "pago.rechazado")  # las ignora un exchange fanout

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logging.getLogger("pika").setLevel(logging.WARNING)
log = logging.getLogger("reportes")

estado = {"clientes": "pendiente", "pedidos": "pendiente",
		  "rabbit": "conectando…" if AMQP_URL else "sin AMQP_URL"}
_enlazados: set = set()


class FuenteError(Exception):
	def __init__(self, status: int, detalle: str):
		super().__init__(detalle)
		self.status, self.detalle = status, detalle


def _estado(clave: str, valor: str):
	if estado.get(clave) != valor:
		estado[clave] = valor
		almacen.al_cambiar()


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
	except (cliente_rpc.ClientesError, requests.RequestException) as e:
		_estado("clientes", "error: " + str(getattr(e, "detalle", e))[:80])
		raise FuenteError(502, estado["clientes"])
	almacen.reemplazar_clientes(lista)
	_estado("clientes", "ok")
	return len(lista)


# ---------- Pedidos ----------
def _pedidos_get(ruta: str):
	r = requests.get(f"{PEDIDOS_URL}{ruta}", timeout=10)
	r.raise_for_status()
	return r.json()


def cargar_pedidos() -> int:
	try:
		datos = _pedidos_get("/api/pedidos")
		lista = datos if isinstance(datos, list) else datos.get("pedidos", [])
		for resumen in lista:
			d = _pedidos_get(f"/api/pedidos/{resumen['id']}")
			p = d.get("pedido", d)
			almacen.guardar_pedido(dict(pedidoId=p["id"], clienteId=p["clienteId"], fecha=p["fecha"],
										total=p["total"], productos=p.get("productos", [])), p.get("estado"))
	except (requests.RequestException, KeyError, ValueError) as e:
		_estado("pedidos", "error: " + type(e).__name__)
		raise FuenteError(502, "No se pudo leer la API de Pedidos")
	_estado("pedidos", "ok")
	return len(lista)


def refrescar_todo() -> dict:
	"""Vuelve a pedir todo a las APIs. Devuelve cuántos datos trajo de cada fuente."""
	res = {}
	for nombre, f in (("clientes", cargar_clientes), ("pedidos", cargar_pedidos)):
		try:
			res[nombre] = f()
		except FuenteError as e:
			res[nombre] = e.detalle
	return res


# ---------- Eventos ----------
def aplicar_evento(d: dict) -> None:
	"""PedidoCreado / PagoAprobado / PagoRechazado. ValueError si el mensaje no sirve."""
	try:
		ev, pid = d["evento"], int(d["pedidoId"])
		if ev == "PedidoCreado":
			almacen.guardar_pedido(dict(d, pedidoId=pid, clienteId=int(d["clienteId"])))
			if int(d["clienteId"]) not in almacen.clientes:      # cliente nuevo: se pide a Clientes
				try:
					almacen.guardar_cliente(traer_cliente(int(d["clienteId"])))
				except FuenteError:
					pass
		elif ev in ("PagoAprobado", "PagoRechazado"):
			almacen.registrar_pago(pid, ev == "PagoAprobado")
		else:
			raise ValueError("Evento no soportado por Reportes: " + str(ev))
	except (KeyError, TypeError) as e:
		raise ValueError("Campo faltante o inválido: " + str(e))


def _enlazar_pagos(conn):
	"""Enlaza la cola de pagos a cada exchange de Pagos que ya exista; reintenta cada 30 s."""
	for ex in EXCHANGES_PAGOS:
		if ex in _enlazados:
			continue
		ch = conn.channel()
		try:
			ch.exchange_declare(exchange=ex, passive=True)   # solo comprueba, no crea
			for clave in CLAVES_PAGOS:
				ch.queue_bind(queue=COLA_PAGOS, exchange=ex, routing_key=clave)
			_enlazados.add(ex)
			log.info("Cola '%s' enlazada a '%s'", COLA_PAGOS, ex)
		except pika.exceptions.ChannelClosedByBroker:
			pass  # aún no existe
		else:
			ch.close()
	if len(_enlazados) < len(EXCHANGES_PAGOS):
		conn.call_later(30, lambda: _enlazar_pagos(conn))


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


def _escuchar():
	conn = pika.BlockingConnection(pika.URLParameters(AMQP_URL))
	ch = conn.channel()
	ch.exchange_declare(exchange=EXCHANGE_PEDIDOS, exchange_type="fanout", durable=True)
	ch.queue_declare(queue=COLA_PEDIDOS, durable=True)
	ch.queue_bind(queue=COLA_PEDIDOS, exchange=EXCHANGE_PEDIDOS)
	ch.queue_declare(queue=COLA_PAGOS, durable=True)
	_enlazar_pagos(conn)
	ch.basic_qos(prefetch_count=1)
	ch.basic_consume(queue=COLA_PEDIDOS, on_message_callback=_al_recibir)
	ch.basic_consume(queue=COLA_PAGOS, on_message_callback=_al_recibir)
	_estado("rabbit", "conectado")
	log.info("Escuchando '%s' y '%s'", COLA_PEDIDOS, COLA_PAGOS)
	ch.start_consuming()


def _bucle_rabbit():
	while True:
		try:
			_escuchar()
		except pika.exceptions.AMQPError as err:
			_enlazados.clear()
			_estado("rabbit", "desconectado, reintentando")
			log.error("Conexión con RabbitMQ perdida (%s). Reintento en 5 s", type(err).__name__)
			time.sleep(5)


def _bucle_refresco():
	while True:
		time.sleep(REFRESCO_SEG)
		refrescar_todo()


def arrancar():
	"""Se llama una vez al iniciar la API (en un hilo aparte)."""
	if AMQP_URL:
		threading.Thread(target=_bucle_rabbit, daemon=True).start()
	refrescar_todo()
	if REFRESCO_SEG > 0:
		threading.Thread(target=_bucle_refresco, daemon=True).start()
