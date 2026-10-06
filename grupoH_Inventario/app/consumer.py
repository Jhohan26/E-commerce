"""Consumidor RabbitMQ: escucha PedidoCreado y publica el resultado."""
import json
import logging
import os
import threading
import time

import pika
import pymysql
from dotenv import load_dotenv

from .db import get_conn
from .inventario import procesar_pedido, validar_pedido

load_dotenv()
log = logging.getLogger("inventario.consumer")

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/%2F")
# Exchange del grupo de Pedidos (fanout): de aquí llegan los PedidoCreado
EXCHANGE_PEDIDOS = os.getenv("RABBITMQ_EXCHANGE_PEDIDOS", "pedidos_exchange")
# Exchange propio (fanout): aquí publicamos InventarioActualizado / Insuficiente
EXCHANGE_INVENTARIO = os.getenv("RABBITMQ_EXCHANGE_INVENTARIO", "inventario_exchange")
QUEUE = os.getenv("RABBITMQ_QUEUE", "cola_inventario")
EVENTO_ENTRADA = "PedidoCreado"


class Consumer(threading.Thread):
    def __init__(self):
        super().__init__(name="consumer-inventario", daemon=True)
        self._parar = threading.Event()
        self._conn = None
        self._canal = None
        self.conectado = False

    # ---------- ciclo de vida ----------
    def run(self):
        while not self._parar.is_set():
            try:
                self._conectar()
                log.info("Escuchando '%s' (enlazada a '%s')", QUEUE, EXCHANGE_PEDIDOS)
                self._canal.start_consuming()
            except pika.exceptions.AMQPError as e:
                log.warning("RabbitMQ no disponible o error AMQP (%s). Reintento en 5 s", e)
            except Exception:
                log.exception("Error inesperado en el consumidor")
            finally:
                self.conectado = False
                self._cerrar()
            self._parar.wait(5)

    def detener(self):
        self._parar.set()
        if self._conn and self._conn.is_open:
            try:
                self._conn.add_callback_threadsafe(self._canal.stop_consuming)
            except Exception:
                pass

    def _conectar(self):
        self._conn = pika.BlockingConnection(pika.URLParameters(RABBITMQ_URL))
        self._canal = self._conn.channel()
        self._asegurar_exchange_pedidos()
        self._canal.confirm_delivery()
        self._canal.exchange_declare(EXCHANGE_INVENTARIO, exchange_type="fanout", durable=True)
        self._canal.queue_declare(QUEUE, durable=True)
        self._canal.queue_bind(QUEUE, EXCHANGE_PEDIDOS, routing_key="")
        self._canal.basic_qos(prefetch_count=1)  # un pedido a la vez
        self._canal.basic_consume(QUEUE, on_message_callback=self._on_message)
        self.conectado = True

    def _asegurar_exchange_pedidos(self):
        """Usa el exchange de Pedidos tal como esté; solo lo crea si aún no existe."""
        try:
            self._canal.exchange_declare(EXCHANGE_PEDIDOS, passive=True)
        except pika.exceptions.ChannelClosedByBroker:
            # No existe todavía: el broker cierra el canal, abrimos uno nuevo y lo creamos
            self._canal = self._conn.channel()
            self._canal.exchange_declare(EXCHANGE_PEDIDOS, exchange_type="fanout", durable=True)

    def _cerrar(self):
        try:
            if self._conn and self._conn.is_open:
                self._conn.close()
        except Exception:
            pass

    # ---------- procesamiento ----------
    def _on_message(self, ch, method, props, body):
        # Convertir el JSON a objeto y validar el contrato
        try:
            datos = json.loads(body)
            tipo = datos.get("evento") if isinstance(datos, dict) else None
            if tipo and tipo != EVENTO_ENTRADA:  # el fanout entrega todo lo que publique Pedidos
                log.info("Evento '%s' ignorado", tipo)
                ch.basic_ack(method.delivery_tag)
                return
            pedido = validar_pedido(datos)
        except ValueError as e:  # incluye JSONDecodeError
            log.error("Mensaje descartado (%s): %r", e, body[:200])
            ch.basic_nack(method.delivery_tag, requeue=False)
            return

        # Procesar en base de datos
        try:
            conn = get_conn()
            try:
                evento, repetido = procesar_pedido(conn, pedido)
            finally:
                conn.close()
        except pymysql.MySQLError:
            log.exception("Error de BD con el pedido %s; se reintentará", pedido["pedidoId"])
            time.sleep(2)
            ch.basic_nack(method.delivery_tag, requeue=True)
            return

        # Generar el nuevo evento y confirmar el mensaje original
        self._publicar(ch, evento)
        ch.basic_ack(method.delivery_tag)
        log.info(
            "Pedido %s -> %s%s",
            pedido["pedidoId"],
            evento["evento"],
            " (reenvío, ya estaba procesado)" if repetido else "",
        )

    @staticmethod
    def _publicar(ch, evento: dict):
        ch.basic_publish(
            exchange=EXCHANGE_INVENTARIO,
            routing_key="",
            body=json.dumps(evento, ensure_ascii=False).encode(),
            properties=pika.BasicProperties(
                content_type="application/json", delivery_mode=2
            ),
        )
