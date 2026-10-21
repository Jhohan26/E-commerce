import argparse
import json
import os
import time
import uuid

import pika
from dotenv import load_dotenv

load_dotenv()

CLOUDAMQP_URL = os.environ["CLOUDAMQP_URL"]
COLA_LOGIN = "productos.login"
COLA_PRODUCTO = "producto.consultar"
COLA_PRODUCTOS = "productos.listar"


class ErrorAPI(Exception):
    def __init__(self, status: int, mensaje: str):
        super().__init__(f"[{status}] {mensaje}")
        self.status = status


class ClienteRPC:
    def __init__(self, usuario: str, password: str):
        self.usuario = usuario
        self.password = password
        self.token = None

        params = pika.URLParameters(CLOUDAMQP_URL)
        params.heartbeat = 30
        self.connection = pika.BlockingConnection(params)
        self.channel = self.connection.channel()
        self.cola_respuesta = self.channel.queue_declare(
            queue="", exclusive=True
        ).method.queue
        self.respuesta = None
        self.corr_id = None
        self.channel.basic_consume(
            queue=self.cola_respuesta,
            on_message_callback=self._on_response,
            auto_ack=True,
        )

    def _on_response(self, ch, method, props, body):
        if props.correlation_id == self.corr_id:
            try:
                self.respuesta = json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.respuesta = {
                    "status": 502,
                    "error": "El worker devolvió una respuesta JSON inválida",
                }

    def _enviar(
        self,
        cola: str,
        payload: dict | None,
        headers: dict | None = None,
        timeout: int = 10,
    ) -> dict:
        self.respuesta = None
        self.corr_id = str(uuid.uuid4())
        self.channel.basic_publish(
            exchange="",
            routing_key=cola,
            properties=pika.BasicProperties(
                reply_to=self.cola_respuesta,
                correlation_id=self.corr_id,
                expiration=str(timeout * 1000),
                headers=headers,
                content_type="application/json",
            ),
            body=json.dumps(payload, ensure_ascii=False).encode("utf-8")
            if payload is not None
            else b"",
        )

        limite = time.monotonic() + timeout
        while self.respuesta is None and time.monotonic() < limite:
            self.connection.process_data_events(time_limit=1)

        if self.respuesta is None:
            raise TimeoutError(f"El worker no respondió a tiempo en la cola {cola}")
        return self.respuesta

    def login(self, timeout: int = 10) -> str:
        respuesta = self._enviar(
            COLA_LOGIN,
            {"usuario": self.usuario, "password": self.password},
            timeout=timeout,
        )
        if respuesta.get("status") != 200:
            raise ErrorAPI(
                respuesta.get("status", 500),
                respuesta.get("error", "Error de autenticación"),
            )

        try:
            self.token = respuesta["data"]["token"]
        except (KeyError, TypeError):
            raise ErrorAPI(502, "Respuesta de login inválida") from None
        return self.token

    def llamar(
        self, cola: str, payload: dict | None = None, timeout: int = 10
    ) -> dict:
        if self.token is None:
            self.login(timeout)

        for intento in range(2):
            respuesta = self._enviar(
                cola,
                payload,
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=timeout,
            )
            if respuesta.get("status") == 401 and intento == 0:
                self.token = None
                self.login(timeout)
                continue
            return respuesta

        return respuesta

    def consultar_producto(self, producto_id: int, timeout: int = 10) -> dict:
        return self.llamar(COLA_PRODUCTO, {"id": producto_id}, timeout)

    def listar_productos(self, timeout: int = 10) -> dict:
        return self.llamar(COLA_PRODUCTOS, timeout=timeout)

    def cerrar(self):
        if self.connection and self.connection.is_open:
            self.connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Cliente RPC de productos con autenticación JWT"
    )
    parser.add_argument(
        "id", nargs="?", type=int, help="ID del producto (si se omite, lista todos)"
    )
    parser.add_argument("-u", "--usuario", help="Usuario configurado en el .env del worker")
    parser.add_argument("-p", "--password", help="Contraseña configurada en el .env del worker")
    args = parser.parse_args()

    usuario = args.usuario or os.getenv("AUTH_USUARIO")
    password = args.password or os.getenv("AUTH_PASSWORD")
    if not usuario or not password:
        parser.error(
            "Indica usuario y contraseña con -u/-p o configura AUTH_USUARIO y AUTH_PASSWORD en .env"
        )

    rpc = None
    try:
        rpc = ClienteRPC(usuario, password)
        if args.id is not None:
            resultado = rpc.consultar_producto(args.id)
        else:
            resultado = rpc.listar_productos()
        print(json.dumps(resultado, indent=2, ensure_ascii=False))
        if resultado.get("status", 500) >= 400:
            raise SystemExit(1)
    except (ErrorAPI, TimeoutError, pika.exceptions.AMQPError) as error:
        print(f"Error: {error}")
        raise SystemExit(1)
    finally:
        if rpc is not None:
            rpc.cerrar()
