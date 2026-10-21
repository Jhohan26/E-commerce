"""Genera tokens JWT DE PRUEBA para la colección de Postman (cliente, operador, administrador,
vencido y alterado). Usa la misma JWT_SECRET con la que el carrito valida.

IMPORTANTE: en la integración real los tokens los emite el módulo de autenticación (Grupo F).
Este script solo sirve para probar el carrito de forma aislada; no lo uses en producción.

Uso:
    python scripts/generar_tokens.py                      # imprime los tokens
    python scripts/generar_tokens.py --cliente-id 3 --postman   # escribe postman/Carrito_local.postman_environment.json
"""
import argparse
import base64
import json
import os
import sys
import time

import jwt
from dotenv import load_dotenv

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def token(secreto, algoritmo, emisor, sub, rol, cliente_id=None, vigencia=3600):
    ahora = int(time.time())
    claims = {"sub": str(sub), "rol": rol, "iss": emisor, "iat": ahora, "exp": ahora + vigencia}
    if cliente_id is not None:
        claims["cliente_id"] = cliente_id
    return jwt.encode(claims, secreto, algorithm=algoritmo)


def alterar_rol(tok, nuevo_rol="administrador"):
    """Cambia el rol en el payload SIN volver a firmar: la firma ya no coincide."""
    h, p, f = tok.split(".")
    datos = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
    datos["rol"] = nuevo_rol
    p2 = base64.urlsafe_b64encode(json.dumps(datos).encode()).rstrip(b"=").decode()
    return f"{h}.{p2}.{f}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cliente-id", type=int, default=3)
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--postman", action="store_true", help="escribir el environment de Postman")
    a = ap.parse_args()

    load_dotenv(os.path.join(RAIZ, ".env"))
    secreto = os.getenv("JWT_SECRET")
    if not secreto:
        sys.exit("Falta JWT_SECRET (en el entorno o en .env). Debe ser la misma que usa el carrito.")
    alg = os.getenv("JWT_ALGORITHM", "HS256")
    iss = os.getenv("JWT_ISSUER") or "auth-service"

    cliente = token(secreto, alg, iss, a.cliente_id, "cliente", a.cliente_id)
    tokens = {
        "token_cliente": cliente,
        "token_operador": token(secreto, alg, iss, 900, "operador"),
        "token_administrador": token(secreto, alg, iss, 1, "administrador"),
        "token_vencido": token(secreto, alg, iss, a.cliente_id, "cliente", a.cliente_id, vigencia=-60),
        "token_alterado": alterar_rol(cliente),
    }
    if not a.postman:
        for k, v in tokens.items():
            print(f"{k}={v}")
        return

    valores = {"base_url": a.base_url, "cliente_id": str(a.cliente_id), "otro_cliente_id": str(a.cliente_id + 1), **tokens}
    env = {
        "name": "Carrito - local",
        "values": [{"key": k, "value": v, "enabled": True, "type": "secret" if k.startswith("token") else "default"} for k, v in valores.items()],
        "_postman_variable_scope": "environment",
    }
    destino = os.path.join(RAIZ, "postman", "Carrito_local.postman_environment.json")
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(env, f, indent=2, ensure_ascii=False)
    print(f"Escrito {destino} (vigencia de los tokens válidos: 1 hora). No lo subas al repositorio.")


if __name__ == "__main__":
    main()
