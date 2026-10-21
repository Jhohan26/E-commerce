import json
import os
import threading
import time
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

# Credenciales para el worker de Clientes (usa JWT). Se leen del .env.
API_USUARIO = os.getenv("API_USUARIO")
API_PASSWORD = os.getenv("API_PASSWORD")
COLA_LOGIN = "auth.login"
# El mismo JWT de servicio que ya se usa con Clientes se envía también a Pedidos (header Authorization).
# Interruptor de emergencia: PEDIDOS_USAR_JWT=false vuelve a llamar a Pedidos sin token.
PEDIDOS_USAR_JWT = os.getenv("PEDIDOS_USAR_JWT", "true").strip().lower() in ("1", "true", "si", "sí", "yes")
_MARGEN_EXPIRACION = 30  # segundos: renovar el token un poco antes de que venza

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


def llamar_rpc(cola: str, payload: dict | None = None, timeout: int = 10, headers: dict | None = None) -> dict:
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
                headers=headers,
            ),
            body=json.dumps(payload).encode() if payload is not None else b"",
        )
        for _ in range(timeout):
            connection.process_data_events(time_limit=1)
            if "data" in resultado:
                return resultado["data"]
        raise TimeoutError(f"No hubo respuesta en la cola '{cola}' a tiempo")
    finally:
        connection.close()


# ---------------------------------------------------------------------------
# Autenticación JWT con el worker de Clientes
# ---------------------------------------------------------------------------
# El token se comparte entre todas las peticiones (FastAPI atiende cada una en un hilo
# distinto), por eso se protege con un lock. Se pide solo cuando hace falta: en la
# primera consulta a Clientes, cuando está por vencer, o cuando el worker responde 401.
_token = {"valor": None, "expira": 0.0}
_token_lock = threading.Lock()


def _login(timeout: int = 10) -> str:
    """Pide un JWT a `auth.login` y lo guarda. Llamar solo con _token_lock tomado."""
    if not API_USUARIO or not API_PASSWORD:
        raise RuntimeError("Faltan API_USUARIO y API_PASSWORD en el .env para autenticarse con Clientes.")
    resp = llamar_rpc(COLA_LOGIN, {"usuario": API_USUARIO, "password": API_PASSWORD}, timeout)
    if resp.get("status") != 200:
        detalle = resp.get("error") or f"status {resp.get('status')}"
        raise RuntimeError(f"Login en Clientes falló: {detalle}")
    data = resp["data"]
    _token["valor"] = data["token"]
    _token["expira"] = time.monotonic() + data.get("expira_en_segundos", 1800) - _MARGEN_EXPIRACION
    return _token["valor"]


def _obtener_token(invalido: str | None = None) -> str:
    """Devuelve un token vigente. `invalido` es un token que el worker acaba de rechazar:
    si otro hilo ya lo renovó, se reutiliza el nuevo en vez de hacer otro login."""
    with _token_lock:
        if _token["valor"] and _token["valor"] != invalido and time.monotonic() < _token["expira"]:
            return _token["valor"]
        return _login()


def llamar_rpc_autenticado(cola: str, payload: dict | None = None, timeout: int = 10) -> dict:
    """Como llamar_rpc, pero enviando el JWT en el header `Authorization: Bearer ...`.
    Si el worker responde 401 (token vencido o inválido), hace login otra vez y reintenta una vez."""
    token = _obtener_token()
    for intento in range(2):
        resp = llamar_rpc(cola, payload, timeout, headers={"Authorization": f"Bearer {token}"})
        if resp.get("status") == 401 and intento == 0:
            token = _obtener_token(invalido=token)
            continue
        break
    return resp


def consultar_cliente(cliente_id: int) -> dict | None:
    """Devuelve el cliente, o None si no existe."""
    if SIMULAR_CLIENTES and cliente_id in CLIENTES_SIMULADOS:
        c = dict(CLIENTES_SIMULADOS[cliente_id])
        c["segundo_apellido"] = (c.get("segundo_apellido") or "") + " [SIMULADO]"
        return c
    resp = llamar_rpc_autenticado("cliente.consultar", {"id": cliente_id})
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
    La llamada va autenticada con JWT (header Authorization: Bearer ...), igual que Clientes.
    Lanza RuntimeError si Pedidos no responde o rechaza el pedido (main.py ya
    muestra ese error y conserva el carrito).
    """
    payload = {"clienteId": cliente_id, "productos": items}
    if cliente_nombre:
        payload["clienteNombre"] = cliente_nombre  # informativo: Pedidos hoy lo ignora
    try:
        if PEDIDOS_USAR_JWT:
            # Credencial de SERVICIO (usuario API_USUARIO), la misma que usa Clientes. No es el token
            # de la persona que compra ni las credenciales de RabbitMQ: son controles distintos.
            resp = llamar_rpc_autenticado(COLA_PEDIDOS, payload, timeout)
        else:
            resp = llamar_rpc(COLA_PEDIDOS, payload, timeout)
    except TimeoutError:
        raise RuntimeError(
            "El microservicio de Pedidos (o el de autenticación) no respondió a tiempo. Verifica que Pedidos "
            "esté corriendo, que en su consola aparezca '[Consumidor Carro] Escuchando...' y que use la misma "
            "instancia de CloudAMQP que este carrito."
        )

    if resp.get("status") in (401, 403):
        raise RuntimeError(
            f"Pedidos rechazó la autenticación del carrito (status {resp.get('status')}). "
            "Revisa API_USUARIO / API_PASSWORD y que ese usuario tenga permiso para crear pedidos."
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
