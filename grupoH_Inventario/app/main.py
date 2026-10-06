import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse

from .consumer import Consumer
from .db import get_db

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

STATIC = Path(__file__).parent / "static"
STOCK_BAJO = int(os.getenv("STOCK_BAJO", "10"))
COLUMNAS = "producto_id, nombre, cantidad, actualizado"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.consumer = Consumer()
    app.state.consumer.start()
    yield
    app.state.consumer.detener()


app = FastAPI(title="Inventario", lifespan=lifespan)


# ---------- Interfaz (solo lectura) ----------
@app.get("/", include_in_schema=False)
def interfaz():
    return FileResponse(STATIC / "index.html")


# ---------- API (solo GET: el inventario no se edita por HTTP) ----------
@app.get("/api/config")
def config():
    return {"stock_bajo": STOCK_BAJO}


@app.get("/api/inventario")
def listar(db=Depends(get_db)):
    with db.cursor() as cur:
        cur.execute(f"SELECT {COLUMNAS} FROM Inventario ORDER BY producto_id")
        return cur.fetchall()


@app.get("/api/inventario/{producto_id}")
def consultar(producto_id: int, db=Depends(get_db)):
    with db.cursor() as cur:
        cur.execute(f"SELECT {COLUMNAS} FROM Inventario WHERE producto_id = %s", (producto_id,))
        fila = cur.fetchone()
    if not fila:
        raise HTTPException(status_code=404, detail="Producto no encontrado en el inventario")
    return fila


@app.get("/health")
def health(db=Depends(get_db)):
    with db.cursor() as cur:
        cur.execute("SELECT 1")
    return {"api": "ok", "base_de_datos": "ok", "rabbitmq": "ok" if app.state.consumer.conectado else "desconectado"}
