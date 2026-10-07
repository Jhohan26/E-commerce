import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .consumer import Consumer
from .db import get_db
from .inventario import ajustar_cantidad

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

# ---------- Edición de cantidades (SOLO desde el equipo local) ----------
def es_local(request: Request) -> bool:
    host = request.client.host if request.client else ""
    return host in ("127.0.0.1", "::1") and "x-forwarded-for" not in request.headers


def solo_local(request: Request):
    """La edición solo se permite desde el equipo donde corre este módulo."""
    if not es_local(request):
        raise HTTPException(
            status_code=403,
            detail="La edición solo está disponible desde el módulo de Inventario (equipo local).",
        )


class Ajuste(BaseModel):
    cantidad: int = Field(ge=0)
    motivo: str | None = Field(default=None, max_length=200)


@app.get("/api/admin/estado")
def estado_edicion(request: Request):
    """La interfaz lo consulta para saber si muestra los campos de edición."""
    return {"editable": es_local(request)}


@app.put("/api/admin/inventario/{producto_id}", dependencies=[Depends(solo_local)])
def ajustar(producto_id: int, ajuste: Ajuste, db=Depends(get_db)):
    try:
        return ajustar_cantidad(db, producto_id, ajuste.cantidad, ajuste.motivo)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))