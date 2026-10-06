"""Envía un PagoAprobado de prueba SOLO a la cola de facturación.

Importante: no publica en pagos_exchange (fanout), porque ese exchange reparte
el mensaje a TODOS los grupos (Notificaciones, Reportes...). Aquí se escribe directo
en la cola, así la prueba no molesta a nadie. Arranca antes el servicio para que
la cola exista.

Uso:
    python scripts/publicar_prueba.py                       # pedido 1001: 2 x producto 15
    python scripts/publicar_prueba.py 1002 15:3 16:5        # pedido 1002 con varios productos
    python scripts/publicar_prueba.py 1003 15:1 --sin-productos   # PagoAprobado sin lista de productos
    python scripts/publicar_prueba.py 1004 15:1 --cliente 99      # con otro clienteId (default 25)
"""
import json
import os
import sys
from datetime import datetime

import pika
from dotenv import load_dotenv

load_dotenv()
URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/%2F")
QUEUE = os.getenv("RABBITMQ_QUEUE", "cola_facturacion")

args = sys.argv[1:]
sin_productos = "--sin-productos" in args
if sin_productos:
    args.remove("--sin-productos")
cliente_id = 25
if "--cliente" in args:
    i = args.index("--cliente")
    cliente_id = int(args[i + 1])
    del args[i:i + 2]

pedido_id = int(args[0]) if args else 1001
pares = args[1:] or ["15:2"]
productos = [
    {"productoId": int(a), "cantidad": int(b), "precio": 2500000}
    for a, b in (p.split(":") for p in pares)
]
evento = {
    "evento": "PagoAprobado",
    "pagoId": pedido_id + 500,
    "pedidoId": pedido_id,
    "clienteId": cliente_id,
    "fecha": datetime.now().isoformat(timespec="seconds"),
    "total": sum(p["cantidad"] * p["precio"] for p in productos),
}
if not sin_productos:
    evento["productos"] = productos

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
