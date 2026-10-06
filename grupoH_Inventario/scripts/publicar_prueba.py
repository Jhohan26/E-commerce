"""Envía un PedidoCreado de prueba SOLO a la cola del inventario.

Importante: no publica en pedidos_exchange (fanout), porque ese exchange reparte
el mensaje a TODOS los grupos (Pagos, Notificaciones...). Aquí se escribe directo
en la cola, así la prueba no molesta a nadie. Arranca antes el servicio para que
la cola exista.

Uso:
    python scripts/publicar_prueba.py                 # pedido 1001: 2 x producto 15
    python scripts/publicar_prueba.py 1002 15:3 16:5  # pedido 1002 con varios productos
"""
import json
import os
import sys
from datetime import datetime

import pika
from dotenv import load_dotenv

load_dotenv()
URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/%2F")
QUEUE = os.getenv("RABBITMQ_QUEUE", "cola_inventario")

pedido_id = int(sys.argv[1]) if len(sys.argv) > 1 else 1001
pares = sys.argv[2:] or ["15:2"]
productos = [
    {"productoId": int(a), "cantidad": int(b), "precio": 2500000}
    for a, b in (p.split(":") for p in pares)
]
evento = {
    "evento": "PedidoCreado",
    "pedidoId": pedido_id,
    "clienteId": 25,
    "fecha": datetime.now().isoformat(timespec="seconds"),
    "total": sum(p["cantidad"] * p["precio"] for p in productos),
    "productos": productos,
}

conn = pika.BlockingConnection(pika.URLParameters(URL))
ch = conn.channel()
ch.queue_declare(QUEUE, durable=True)
ch.basic_publish(
    exchange="",            # exchange por defecto: entrega directa a la cola
    routing_key=QUEUE,
    body=json.dumps(evento).encode(),
    properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
)
conn.close()
print(f"Enviado a la cola '{QUEUE}':")
print(json.dumps(evento, indent=2))
