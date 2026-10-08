import json
import os
import uuid
from datetime import datetime

import pika
from dotenv import load_dotenv

load_dotenv()

CLOUDAMQP_URL = os.environ["CLOUDAMQP_URL"]
EXCHANGE = os.getenv("PEDIDOS_EXCHANGE", "pedidos_exchange")
ROUTING_KEY = os.getenv("PEDIDOS_ROUTING_KEY", "pedido.creado")


def _conectar() -> pika.BlockingConnection:
    params = pika.URLParameters(CLOUDAMQP_URL)
    params.heartbeat = 30
    return pika.BlockingConnection(params)


def llamar_rpc(cola: str, payload: dict | None = None, timeout: int = 10) -> dict:
    """Petición/respuesta (RPC) sobre una cola. Abre una conexión por llamada,
    así es seguro usarla desde los hilos de FastAPI."""
    connection = _conectar()
    try:
        channel = connection.channel()
        cola_respuesta = channel.queue_declare(queue="", exclusive=True).method.queue
        corr_id = str(uuid.uuid4())
        resultado = {}

        def on_response(ch, method, props, body):
            if props.correlation_id == corr_id:
                resultado["data"] = json.loads(body)

        channel.basic_consume(queue=cola_respuesta, on_message_callback=on_response, auto_ack=True)
        channel.basic_publish(
            exchange="",
            routing_key=cola,
            properties=pika.BasicProperties(
                reply_to=cola_respuesta,
                correlation_id=corr_id,
                expiration=str(timeout * 1000),
            ),
            body=json.dumps(payload).encode() if payload is not None else b"",
        )
        for _ in range(timeout):
            connection.process_data_events(time_limit=1)
            if "data" in resultado:
                return resultado["data"]
        raise TimeoutError("El worker de clientes no respondió a tiempo")
    finally:
        connection.close()


def consultar_cliente(cliente_id: int) -> dict | None:
    """Devuelve el cliente, o None si no existe."""
    resp = llamar_rpc("cliente.consultar", {"id": cliente_id})
    if resp.get("status") == 200:
        return resp["data"]
    if resp.get("status") == 404:
        return None
    raise RuntimeError(resp.get("error", f"Error del worker (status {resp.get('status')})"))


def publicar_pedido(cliente_id: int, items: list[dict]) -> dict:
    """Publica el evento PedidoCreado en el exchange fanout `pedidos_exchange`.

    items: [{"productoId", "cantidad", "precio"}]
    """
    evento = {
        "evento": "PedidoCreado",
        # Id provisional generado aquí (milisegundos). Si el módulo de Pedidos
        # asigna los ids, hay que cambiar esto (ver README).
        "pedidoId": int(datetime.now().timestamp() * 1000),
        "clienteId": cliente_id,
        "fecha": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "total": sum(i["cantidad"] * i["precio"] for i in items),
        "productos": items,
    }
    connection = _conectar()
    try:
        channel = connection.channel()
        channel.confirm_delivery()  # lanza excepción si el broker no confirma
        channel.exchange_declare(exchange=EXCHANGE, exchange_type="fanout", durable=True)
        channel.basic_publish(
            exchange=EXCHANGE,
            routing_key=ROUTING_KEY,
            body=json.dumps(evento).encode("utf-8"),
            properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
        )
    finally:
        connection.close()
    return evento
