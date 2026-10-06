import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse, Response

from . import facturacion
from .consumer import Consumer
from .db import get_db
from .pdf import generar_pdf

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

STATIC = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.consumer = Consumer()
    app.state.consumer.start()
    yield
    app.state.consumer.detener()


app = FastAPI(title="Facturación", lifespan=lifespan)


def _una(db, campo, valor):
    filas = facturacion.consultar(db, campo, valor)
    if not filas:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return filas[0]


# ---------- Interfaz (solo lectura) ----------
@app.get("/", include_in_schema=False)
def interfaz():
    return FileResponse(STATIC / "index.html")


# ---------- API (solo GET: las facturas se crean al recibir un PagoAprobado) ----------
@app.get("/api/facturas")
def listar(db=Depends(get_db)):
    return facturacion.consultar(db)


@app.get("/api/facturas/pedido/{pedido_id}")
def por_pedido(pedido_id: int, db=Depends(get_db)):
    return _una(db, "pedido_id", pedido_id)


@app.get("/api/facturas/cliente/{cliente_id}")
def por_cliente(cliente_id: int, db=Depends(get_db)):
    return facturacion.consultar(db, "cliente_id", cliente_id)


@app.get("/api/facturas/{factura_id}")
def consultar(factura_id: int, db=Depends(get_db)):
    return _una(db, "id", factura_id)


@app.get("/api/facturas/{factura_id}/pdf")
def descargar_pdf(factura_id: int, db=Depends(get_db)):
    factura = _una(db, "id", factura_id)
    return Response(
        content=generar_pdf(factura),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{factura["numero"]}.pdf"'},
    )


@app.get("/health")
def health(db=Depends(get_db)):
    with db.cursor() as cur:
        cur.execute("SELECT 1")
    return {"api": "ok", "base_de_datos": "ok", "rabbitmq": "ok" if app.state.consumer.conectado else "desconectado"}
