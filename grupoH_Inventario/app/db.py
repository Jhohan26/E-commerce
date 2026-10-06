import os

import pymysql
from dotenv import load_dotenv
from pymysql.cursors import DictCursor

load_dotenv()


def _config() -> dict:
    cfg = dict(
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "inventario"),
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=False,
    )
    socket = os.getenv("DB_SOCKET")
    if socket:
        cfg["unix_socket"] = socket
    else:
        cfg["host"] = os.getenv("DB_HOST", "localhost")
        cfg["port"] = int(os.getenv("DB_PORT", "3306"))
    return cfg


def get_conn():
    return pymysql.connect(**_config())


def get_db():
    """Dependencia de FastAPI: una conexión por petición."""
    conn = get_conn()
    try:
        yield conn
    finally:
        conn.close()
