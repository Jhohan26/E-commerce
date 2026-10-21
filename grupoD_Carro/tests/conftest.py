import os
import sys
import time

import jwt
import pytest

# Variables mínimas ANTES de importar la app (rabbit.py exige CLOUDAMQP_URL al importarse).
os.environ.setdefault("CLOUDAMQP_URL", "amqp://test:test@localhost/test")
os.environ["JWT_SECRET"] = "secreto-de-pruebas-solo-para-tests-0123456789"
os.environ.pop("JWT_ISSUER", None)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SECRETO = os.environ["JWT_SECRET"]


def hacer_token(sub="3", rol="cliente", cliente_id=3, exp_en=3600, secreto=SECRETO, **extra):
    claims = {"sub": sub, "rol": rol, "iss": "auth-service", "iat": int(time.time()), "exp": int(time.time()) + exp_en, **extra}
    if cliente_id is not None:
        claims["cliente_id"] = cliente_id
    return jwt.encode(claims, secreto, algorithm="HS256")


def cabecera(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def app_cliente(monkeypatch):
    from fastapi.testclient import TestClient

    import main
    import productos
    import rabbit

    catalogo = [{"id": 1, "nombre": "MACBOOK", "precio": 2500000}, {"id": 2, "nombre": "Audífonos", "precio": 150000}]
    monkeypatch.setattr(productos, "listar_productos", lambda: catalogo)
    monkeypatch.setattr(productos, "obtener_producto", lambda pid: next((p for p in catalogo if p["id"] == pid), None))
    monkeypatch.setattr(rabbit, "consultar_cliente",
                        lambda cid: {"id": cid, "primer_nombre": "Ana", "primer_apellido": "Pérez", "estado": 0 if cid == 8 else 1} if cid != 99 else None)
    enviados = []

    def falso_publicar(cid, items, timeout=15, cliente_nombre=None):
        enviados.append((cid, items))
        return {"evento": "PedidoCreado", "pedidoId": 7, "clienteId": cid, "total": sum(i["cantidad"] * i["precio"] for i in items), "productos": items}

    monkeypatch.setattr(rabbit, "publicar_pedido", falso_publicar)
    main.carritos.clear()
    client = TestClient(main.app, follow_redirects=False)
    client.enviados = enviados
    yield client
    main.carritos.clear()
