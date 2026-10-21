"""Pruebas de seguridad de la API del carrito (equivalen a la colección de Postman, Fase 4)."""
import jwt
import pytest

from conftest import cabecera, hacer_token

ITEM = {"producto_id": 1, "cantidad": 2}


# --- 1. Endpoint público sin token -----------------------------------------------------------
def test_publico_sin_token(app_cliente):
    assert app_cliente.get("/api/productos").status_code == 200
    assert app_cliente.get("/health").json() == {"status": "ok"}
    assert app_cliente.get("/ready").status_code == 200


# --- 2. Endpoint protegido sin token ---------------------------------------------------------
@pytest.mark.parametrize("metodo,ruta,kw", [
    ("get", "/api/carrito/3", {}),
    ("post", "/api/carrito/3/items", {"json": ITEM}),
    ("delete", "/api/carrito/3/items/1", {}),
    ("delete", "/api/carrito/3", {}),
    ("post", "/api/carrito/3/pedido", {}),
])
def test_protegido_sin_token_401(app_cliente, metodo, ruta, kw):
    r = getattr(app_cliente, metodo)(ruta, **kw)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


def test_cabecera_sin_esquema_bearer_401(app_cliente):
    assert app_cliente.get("/api/carrito/3", headers={"Authorization": "abc"}).status_code == 401
    assert app_cliente.get("/api/carrito/3", headers={"Authorization": "Basic abc"}).status_code == 401


# --- 3. Token válido -------------------------------------------------------------------------
def test_token_valido(app_cliente):
    h = cabecera(hacer_token())
    r = app_cliente.post("/api/carrito/3/items", json=ITEM, headers=h)
    assert r.status_code == 201 and r.json()["total"] == 5000000
    assert app_cliente.get("/api/carrito/3", headers=h).json()["total"] == 5000000


# --- 4. Token alterado -----------------------------------------------------------------------
def test_token_firmado_con_otra_clave_401(app_cliente):
    assert app_cliente.get("/api/carrito/3", headers=cabecera(hacer_token(secreto="otra-clave-distinta-0123456789abcdef"))).status_code == 401


def test_token_con_payload_modificado_401(app_cliente):
    h, p, f = hacer_token(rol="cliente").split(".")
    import base64, json
    datos = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
    datos["rol"] = "administrador"  # intento de escalar privilegios sin re-firmar
    p2 = base64.urlsafe_b64encode(json.dumps(datos).encode()).rstrip(b"=").decode()
    assert app_cliente.get("/api/carrito/3", headers=cabecera(f"{h}.{p2}.{f}")).status_code == 401


def test_token_alg_none_401(app_cliente):
    sin_firma = jwt.encode({"sub": "3", "rol": "administrador", "exp": 9999999999}, key=None, algorithm="none")
    assert app_cliente.get("/api/carrito/3", headers=cabecera(sin_firma)).status_code == 401


def test_texto_cualquiera_como_token_401(app_cliente):
    """No basta con que exista algo en Authorization: se valida el token."""
    assert app_cliente.get("/api/carrito/3", headers=cabecera("cualquier-texto")).status_code == 401


# --- 5. Token vencido ------------------------------------------------------------------------
def test_token_vencido_401(app_cliente):
    r = app_cliente.get("/api/carrito/3", headers=cabecera(hacer_token(exp_en=-10)))
    assert r.status_code == 401 and "vencido" in r.json()["detail"]


# --- claims obligatorios ---------------------------------------------------------------------
def test_token_sin_exp_401(app_cliente):
    t = jwt.encode({"sub": "3", "rol": "cliente"}, "secreto-de-pruebas-solo-para-tests-0123456789", algorithm="HS256")
    assert app_cliente.get("/api/carrito/3", headers=cabecera(t)).status_code == 401


def test_token_sin_rol_o_rol_desconocido_401(app_cliente):
    t = jwt.encode({"sub": "3", "exp": 9999999999}, "secreto-de-pruebas-solo-para-tests-0123456789", algorithm="HS256")
    assert app_cliente.get("/api/carrito/3", headers=cabecera(t)).status_code == 401
    assert app_cliente.get("/api/carrito/3", headers=cabecera(hacer_token(rol="superusuario"))).status_code == 401


def test_emisor_incorrecto_401(app_cliente, monkeypatch):
    monkeypatch.setenv("JWT_ISSUER", "otro-emisor")
    assert app_cliente.get("/api/carrito/3", headers=cabecera(hacer_token())).status_code == 401


def test_sin_jwt_secret_falla_cerrado_503(app_cliente, monkeypatch):
    monkeypatch.delenv("JWT_SECRET")
    assert app_cliente.get("/api/carrito/3", headers=cabecera(hacer_token())).status_code == 503


# --- 6. Rol no autorizado / 7. rol autorizado ------------------------------------------------
def test_operador_no_autorizado_403(app_cliente):
    h = cabecera(hacer_token(sub="50", rol="operador", cliente_id=None))
    assert app_cliente.get("/api/carrito/3", headers=h).status_code == 403
    assert app_cliente.post("/api/carrito/3/pedido", headers=h).status_code == 403


def test_administrador_puede_ver_pero_no_modificar(app_cliente):
    h = cabecera(hacer_token(sub="1", rol="administrador", cliente_id=None))
    assert app_cliente.get("/api/carrito/3", headers=h).status_code == 200
    assert app_cliente.post("/api/carrito/3/items", json=ITEM, headers=h).status_code == 403
    assert app_cliente.post("/api/carrito/3/pedido", headers=h).status_code == 403


def test_cliente_no_accede_al_carrito_de_otro_403(app_cliente):
    h = cabecera(hacer_token(cliente_id=3))
    assert app_cliente.get("/api/carrito/4", headers=h).status_code == 403
    assert app_cliente.post("/api/carrito/4/items", json=ITEM, headers=h).status_code == 403
    assert app_cliente.post("/api/carrito/4/pedido", headers=h).status_code == 403


def test_identidad_sale_del_token_no_del_cuerpo(app_cliente):
    """Un cliente_id/rol enviado en el cuerpo o en cabeceras propias no otorga nada."""
    h = {**cabecera(hacer_token(cliente_id=3)), "X-Rol": "administrador", "X-User-Id": "4"}
    r = app_cliente.post("/api/carrito/4/items", json={**ITEM, "rol": "administrador", "cliente_id": 4}, headers=h)
    assert r.status_code == 403


def test_cliente_id_cae_en_sub_si_no_hay_claim(app_cliente):
    h = cabecera(hacer_token(sub="3", cliente_id=None))
    assert app_cliente.get("/api/carrito/3", headers=h).status_code == 200
    assert app_cliente.get("/api/carrito/4", headers=h).status_code == 403


# --- Flujo de pedidos protegido --------------------------------------------------------------
def test_flujo_pedido_completo(app_cliente):
    h = cabecera(hacer_token())
    app_cliente.post("/api/carrito/3/items", json=ITEM, headers=h)
    r = app_cliente.post("/api/carrito/3/pedido", headers=h)
    assert r.status_code == 201 and r.json()["pedidoId"] == 7
    assert app_cliente.enviados[0][0] == 3
    assert app_cliente.get("/api/carrito/3", headers=h).json()["lineas"] == []  # carrito vaciado


def test_pedido_con_carrito_vacio_409(app_cliente):
    assert app_cliente.post("/api/carrito/3/pedido", headers=cabecera(hacer_token())).status_code == 409


def test_cliente_inexistente_404_y_deshabilitado_403(app_cliente):
    assert app_cliente.post("/api/carrito/99/pedido", headers=cabecera(hacer_token(cliente_id=99))).status_code == 404
    h8 = cabecera(hacer_token(sub="8", cliente_id=8))
    app_cliente.post("/api/carrito/8/items", json=ITEM, headers=h8)
    assert app_cliente.post("/api/carrito/8/pedido", headers=h8).status_code == 403


def test_pedidos_caido_devuelve_502_y_conserva_carrito(app_cliente, monkeypatch):
    import rabbit

    def falla(*a, **k):
        raise RuntimeError("Pedidos no respondió")

    monkeypatch.setattr(rabbit, "publicar_pedido", falla)
    h = cabecera(hacer_token())
    app_cliente.post("/api/carrito/3/items", json=ITEM, headers=h)
    assert app_cliente.post("/api/carrito/3/pedido", headers=h).status_code == 502
    assert app_cliente.get("/api/carrito/3", headers=h).json()["total"] == 5000000


def test_validacion_de_entrada(app_cliente):
    h = cabecera(hacer_token())
    assert app_cliente.post("/api/carrito/3/items", json={"producto_id": 1, "cantidad": 0}, headers=h).status_code == 422
    assert app_cliente.post("/api/carrito/3/items", json={"producto_id": 777}, headers=h).status_code == 404


# --- La interfaz web sigue igual -------------------------------------------------------------
def test_interfaz_web_sin_cambios(app_cliente):
    assert app_cliente.get("/").status_code == 200
    assert app_cliente.get("/?cliente_id=3").headers["location"] == "/cliente/3"
    assert app_cliente.get("/cliente/3").status_code == 200
    assert app_cliente.get("/cliente/99").status_code == 404
    assert app_cliente.post("/cliente/3/agregar", data={"producto_id": 1, "cantidad": 2}).status_code == 303
    r = app_cliente.post("/cliente/3/pedido")
    assert r.status_code == 200 and "7" in r.text
