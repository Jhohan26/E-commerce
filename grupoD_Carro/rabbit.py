import json
import os
import uuid

import pika
from dotenv import load_dotenv

load_dotenv()

CLOUDAMQP_URL = os.environ["CLOUDAMQP_URL"]
EXCHANGE = os.getenv("PEDIDOS_EXCHANGE", "pedidos_exchange")
ROUTING_KEY = os.getenv("PEDIDOS_ROUTING_KEY", "pedido.creado")
# Por defecto los clientes se SIMULAN localmente (sin el worker de Clientes). Solo para pruebas.
# Cuando el grupo de Clientes esté disponible, pon SIMULAR_CLIENTES=false en el .env.
SIMULAR_CLIENTES = os.getenv("SIMULAR_CLIENTES", "true").strip().lower() in ("1", "true", "si", "sí", "yes")

print("[clientes] MODO SIMULADO activo: no se consulta al worker de Clientes" if SIMULAR_CLIENTES else "[clientes] Modo REAL: se consulta al worker de Clientes por RabbitMQ")

# Clientes de prueba, con los mismos campos que devuelve el worker de Clientes.
# El id 25 es el del ejemplo del README de Pedidos; el 99 está deshabilitado (estado 0).
CLIENTES_SIMULADOS = {
    1: {"id": 1, "primer_nombre": "Ana", "segundo_nombre": "María", "primer_apellido": "Gómez", "segundo_apellido": "Pérez", "correo": "ana.gomez@correo.com", "estado": 1},
    2: {"id": 2, "primer_nombre": "Carlos", "segundo_nombre": "", "primer_apellido": "Rodríguez", "segundo_apellido": "Díaz", "correo": "carlos.rodriguez@correo.com", "estado": 1},
    25: {"id": 25, "primer_nombre": "Laura", "segundo_nombre": "Sofía", "primer_apellido": "Martínez", "segundo_apellido": "Ruiz", "correo": "laura.martinez@correo.com", "estado": 1},
    99: {"id": 99, "primer_nombre": "Cliente", "segundo_nombre": "", "primer_apellido": "Deshabilitado", "segundo_apellido": "", "correo": "deshabilitado@correo.com", "estado": 0},
}


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
    if SIMULAR_CLIENTES:
        c = dict(CLIENTES_SIMULADOS.get(cliente_id) or {
            "id": cliente_id, "primer_nombre": "Cliente", "segundo_nombre": "",
            "primer_apellido": f"de prueba {cliente_id}", "segundo_apellido": "",
            "correo": f"cliente{cliente_id}@prueba.com", "estado": 1,
        })
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
