"""La llamada del carrito a Pedidos (`pedidos.desde_carro`) va autenticada con JWT de servicio."""
import pytest

import rabbit

ITEMS = [{"productoId": 1, "cantidad": 2, "precio": 100}]
OK = {"status": 201, "data": {"pedidoId": 55, "clienteId": 3, "fecha": "2026-10-20", "total": 200}}


@pytest.fixture(autouse=True)
def estado_limpio(monkeypatch):
    monkeypatch.setattr(rabbit, "PEDIDOS_USAR_JWT", True)
    monkeypatch.setattr(rabbit, "API_USUARIO", "modulo_carro")
    monkeypatch.setattr(rabbit, "API_PASSWORD", "x")
    rabbit._token.update(valor=None, expira=0.0)
    yield
    rabbit._token.update(valor=None, expira=0.0)


def instalar_broker_falso(monkeypatch, respuestas_pedidos):
    llamadas = []
    tokens = iter(["TOKEN-1", "TOKEN-2", "TOKEN-3"])

    def falso(cola, payload=None, timeout=10, headers=None):
        llamadas.append((cola, payload, headers))
        if cola == rabbit.COLA_LOGIN:
            return {"status": 200, "data": {"token": next(tokens), "expira_en_segundos": 3600}}
        return respuestas_pedidos.pop(0)

    monkeypatch.setattr(rabbit, "llamar_rpc", falso)
    return llamadas


def test_pedido_envia_bearer(monkeypatch):
    llamadas = instalar_broker_falso(monkeypatch, [OK])
    evento = rabbit.publicar_pedido(3, ITEMS)
    assert evento["pedidoId"] == 55
    cola, payload, headers = llamadas[-1]
    assert cola == "pedidos.desde_carro" and headers == {"Authorization": "Bearer TOKEN-1"}
    assert payload["clienteId"] == 3


def test_token_se_reutiliza_entre_pedidos(monkeypatch):
    llamadas = instalar_broker_falso(monkeypatch, [OK, OK])
    rabbit.publicar_pedido(3, ITEMS)
    rabbit.publicar_pedido(3, ITEMS)
    assert [c[0] for c in llamadas].count(rabbit.COLA_LOGIN) == 1


def test_401_renueva_token_y_reintenta_una_vez(monkeypatch):
    llamadas = instalar_broker_falso(monkeypatch, [{"status": 401, "error": "token vencido"}, OK])
    assert rabbit.publicar_pedido(3, ITEMS)["pedidoId"] == 55
    enviados = [c[2]["Authorization"] for c in llamadas if c[0] == "pedidos.desde_carro"]
    assert enviados == ["Bearer TOKEN-1", "Bearer TOKEN-2"]


def test_401_persistente_da_mensaje_claro(monkeypatch):
    instalar_broker_falso(monkeypatch, [{"status": 401}, {"status": 401}])
    with pytest.raises(RuntimeError, match="rechazó la autenticación"):
        rabbit.publicar_pedido(3, ITEMS)


def test_403_da_mensaje_de_permiso(monkeypatch):
    instalar_broker_falso(monkeypatch, [{"status": 403, "error": "rol"}])
    with pytest.raises(RuntimeError, match="permiso"):
        rabbit.publicar_pedido(3, ITEMS)


def test_error_de_negocio_sigue_mostrando_su_mensaje(monkeypatch):
    instalar_broker_falso(monkeypatch, [{"status": 400, "error": "Producto sin stock"}])
    with pytest.raises(RuntimeError, match="Producto sin stock"):
        rabbit.publicar_pedido(3, ITEMS)


def test_interruptor_apagado_no_envia_token_ni_hace_login(monkeypatch):
    monkeypatch.setattr(rabbit, "PEDIDOS_USAR_JWT", False)
    llamadas = instalar_broker_falso(monkeypatch, [OK])
    rabbit.publicar_pedido(3, ITEMS)
    assert [c[0] for c in llamadas] == ["pedidos.desde_carro"] and llamadas[0][2] is None


def test_timeout_se_reporta_como_error_de_pedidos(monkeypatch):
    def timeout(*a, **k):
        raise TimeoutError("sin respuesta")

    monkeypatch.setattr(rabbit, "llamar_rpc", timeout)
    with pytest.raises(RuntimeError, match="no respondió a tiempo"):
        rabbit.publicar_pedido(3, ITEMS)
