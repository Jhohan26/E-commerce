import json
import os
import uuid

import pika
from dotenv import load_dotenv

load_dotenv()

CLOUDAMQP_URL = os.environ["CLOUDAMQP_URL"]
EXCHANGE = os.getenv("PEDIDOS_EXCHANGE", "pedidos_exchange")
ROUTING_KEY = os.getenv("PEDIDOS_ROUTING_KEY", "pedido.creado")
# Solo el id 25 se SIMULA (cliente de prueba). Todos los demás ids (1 al 5, etc.) se consultan al
# worker REAL de Clientes por RabbitMQ. Para que también el 25 vaya al worker real: SIMULAR_CLIENTES=false en el .env.
SIMULAR_CLIENTES = os.getenv("SIMULAR_CLIENTES", "true").strip().lower() in ("1", "true", "si", "sí", "yes")

# Cliente de prueba, con los mismos campos que devuelve el worker de Clientes.
# El id 25 es el del ejemplo del README de Pedidos.
CLIENTES_SIMULADOS = {
    25: {"id": 25, "primer_nombre": "Laura", "segundo_nombre": "Sofía", "primer_apellido": "Martínez", "segundo_apellido": "Ruiz", "correo": "laura.martinez@correo.com", "estado": 1},
}

print(f"[clientes] Clientes REALES por RabbitMQ (worker de Clientes). Simulados: {sorted(CLIENTES_SIMULADOS) if SIMULAR_CLIENTES else 'ninguno'}")


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
    if SIMULAR_CLIENTES and cliente_id in CLIENTES_SIMULADOS:
        c = dict(CLIENTES_SIMULADOS[cliente_id])
        c["segundo_apellido"] = (c.get("segundo_apellido") or "") + " [SIMULADO]"
        return c
    resp = llamar_rpc("cliente.consultar", {"id": cliente_id})
    if resp.get("status") == 200:
        return resp["data"]
    if resp.get("status") == 404:
        return None
    raise RuntimeError(resp.get("error", f"Error del worker (status {resp.get('status')})"))


COLA_PEDIDOS = "pedidos.desde_carro"  # cola RPC que escucha el microservicio de Pedidos (Grupo E)


def publicar_pedido(cliente_id: int, items: list[dict], timeout: int = 15, cliente_nombre: str | None = None) -> dict:
    """Crea el pedido en el microservicio de Pedidos por RPC (cola `pedidos.desde_carro`).

    Pedidos guarda el pedido en su base de datos, le asigna el id real y publica él
    mismo el evento PedidoCreado en `pedidos_exchange`; por eso el carrito ya NO
    publica el evento por su cuenta (no se duplica ni se inventa el pedidoId).

    Devuelve un dict con la forma del evento PedidoCreado (evento, pedidoId,
    clienteId, fecha, total, productos): main.py y los templates no cambian.
    Lanza RuntimeError si Pedidos no responde o rechaza el pedido (main.py ya
    muestra ese error y conserva el carrito).
    """
    payload = {"clienteId": cliente_id, "productos": items}
    if cliente_nombre:
        payload["clienteNombre"] = cliente_nombre  # informativo: Pedidos hoy lo ignora
    try:
        resp = llamar_rpc(COLA_PEDIDOS, payload, timeout)
    except TimeoutError:
        raise RuntimeError(
            "El microservicio de Pedidos no respondió a tiempo. Verifica que Pedidos esté corriendo, "
            "que en su consola aparezca '[Consumidor Carro] Escuchando...' y que use la misma "
            "instancia de CloudAMQP que este carrito."
        )

    if resp.get("status") not in (200, 201):
        raise RuntimeError(resp.get("error") or f"Pedidos rechazó el pedido (status {resp.get('status')})")

    data = resp.get("data") or {}
    if data.get("pedidoId") is None:
        raise RuntimeError(f"Respuesta inesperada de Pedidos: {str(resp)[:200]}")

    total_calculado = sum(i["cantidad"] * i["precio"] for i in items)
    evento = {
        "evento": "PedidoCreado",
        "pedidoId": data["pedidoId"],
        "clienteId": data.get("clienteId", cliente_id),
        "fecha": data.get("fecha"),
        "total": int(round(float(data.get("total", total_calculado)))),
        "productos": items,
    }
    if cliente_nombre:
        evento["clienteNombre"] = cliente_nombre  # solo para mostrar en la confirmación del carrito
    return evento
