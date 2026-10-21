"""Productos con JWT: el catálogo se pide por cliente_rpc.ClienteRPC (login en productos.login)."""

import pika
import pytest

import productos


class RpcFalso:
    instancias = []
    fallos_conexion = 0  # cuántas llamadas deben fallar con AMQPError antes de responder

    def __init__(self, usuario, password):
        self.usuario, self.password, self.token, self.cerrado = usuario, password, None, False
        RpcFalso.instancias.append(self)

    def listar_productos(self, timeout=10):
        if RpcFalso.fallos_conexion > 0:
            RpcFalso.fallos_conexion -= 1
            raise pika.exceptions.AMQPConnectionError("conexión caída")
        if self.token is None:
            self.token = "jwt-productos"
        return {"status": 200, "data": [{"id": 1, "nombre": "Zapatilla", "precio": 2500000.0}]}

    def cerrar(self):
        self.cerrado = True


@pytest.fixture(autouse=True)
def entorno(monkeypatch):
    RpcFalso.instancias, RpcFalso.fallos_conexion = [], 0
    monkeypatch.setattr(productos, "ClienteRPC", RpcFalso)
    monkeypatch.setattr(productos, "PRODUCTOS_USUARIO", "productos")
    monkeypatch.setattr(productos, "PRODUCTOS_PASSWORD", "productos1")
    monkeypatch.setattr(productos, "_rpc", None)
    monkeypatch.setattr(productos, "_guardar_en_disco", lambda p: None)
    monkeypatch.setattr(productos, "_leer_de_disco", lambda: [])
    monkeypatch.setitem(productos._estado, "productos", None)
    monkeypatch.setitem(productos._estado, "ultimo_ok", float("-inf"))
    monkeypatch.setitem(productos._estado, "ultimo_fallo", float("-inf"))


def test_usa_las_credenciales_de_productos_y_normaliza():
    lista = productos.listar_productos()
    assert lista[0]["precio"] == 2500000 and lista[0]["nombre"] == "Zapatilla"
    assert (RpcFalso.instancias[0].usuario, RpcFalso.instancias[0].password) == ("productos", "productos1")


def test_reconecta_y_conserva_el_token_si_la_conexion_se_cayo():
    productos.listar_productos()  # primera consulta: obtiene token
    token = RpcFalso.instancias[0].token
    productos._estado["ultimo_ok"] = float("-inf")  # fuerza refresco
    RpcFalso.fallos_conexion = 1
    productos.listar_productos()
    assert len(RpcFalso.instancias) == 2 and RpcFalso.instancias[0].cerrado
    assert RpcFalso.instancias[1].token == token


def test_sin_credenciales_usa_el_ultimo_catalogo(monkeypatch):
    monkeypatch.setattr(productos, "PRODUCTOS_PASSWORD", None)
    monkeypatch.setitem(productos._estado, "productos", [{"id": 9, "nombre": "Cache", "precio": 1}])
    assert productos.listar_productos()[0]["nombre"] == "Cache"


def test_si_productos_rechaza_el_login_sigue_con_el_catalogo_previo(monkeypatch):
    class Rechaza(RpcFalso):
        def listar_productos(self, timeout=10):
            raise RuntimeError("[401] Credenciales inválidas")

    monkeypatch.setattr(productos, "ClienteRPC", Rechaza)
    monkeypatch.setitem(productos._estado, "productos", [{"id": 9, "nombre": "Cache", "precio": 1}])
    assert productos.listar_productos()[0]["id"] == 9
