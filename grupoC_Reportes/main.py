import asyncio
import os
import threading
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

load_dotenv()

import almacen  # noqa: E402  (después de cargar el .env)
import fuentes  # noqa: E402

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
suscriptores: set[asyncio.Queue] = set()   # un navegador abierto = una cola
loop: asyncio.AbstractEventLoop | None = None


def _difundir():
	for q in list(suscriptores):
		try:
			q.put_nowait("cambio")
		except asyncio.QueueFull:
			pass   # ya tiene un aviso pendiente


def notificar():
	"""Avisa a todos los dashboards abiertos. Se puede llamar desde cualquier hilo."""
	if loop:
		loop.call_soon_threadsafe(_difundir)


almacen.al_cambiar = notificar


@asynccontextmanager
async def lifespan(app: FastAPI):
	global loop
	loop = asyncio.get_running_loop()
	threading.Thread(target=fuentes.arrancar, daemon=True).start()
	yield


app = FastAPI(title="Reportes", lifespan=lifespan)


# ---------- Dashboard y canal en vivo ----------
@app.get("/", include_in_schema=False)
@app.get("/dashboard", include_in_schema=False)
def dashboard():
	return FileResponse(os.path.join(BASE_DIR, "static", "dashboard.html"))


@app.get("/stream", include_in_schema=False)
async def stream():
	"""Server-Sent Events: el navegador recibe un aviso en cuanto cambia algún dato."""
	cola: asyncio.Queue = asyncio.Queue(maxsize=1)
	suscriptores.add(cola)

	async def generador():
		try:
			yield "retry: 3000\n\ndata: hola\n\n"
			while True:
				try:
					await asyncio.wait_for(cola.get(), timeout=15)
					yield "data: cambio\n\n"
				except asyncio.TimeoutError:
					yield ": ping\n\n"
		finally:
			suscriptores.discard(cola)

	return StreamingResponse(generador(), media_type="text/event-stream",
							 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/estado")
def estado():
	"""Estado de las conexiones con Clientes, Pedidos y RabbitMQ."""
	return fuentes.estado


@app.post("/sincronizar")
def sincronizar():
	"""Vuelve a pedir todo a las APIs de Clientes y Pedidos."""
	return fuentes.refrescar_todo()


# ---------- Clientes ----------
class ConsultaCliente(BaseModel):
	id: int


@app.post("/cliente")
def cliente(consulta: ConsultaCliente):
	"""Mismo contrato que Clientes: recibe {"id": N} y devuelve los datos del cliente."""
	try:
		datos = fuentes.traer_cliente(consulta.id)
	except fuentes.FuenteError as e:
		raise HTTPException(status_code=e.status, detail=e.detalle)
	almacen.guardar_cliente(datos)
	return datos


@app.get("/clientes")
def clientes():
	return almacen.lista_clientes()


# ---------- Eventos por HTTP (alternativa a RabbitMQ, útil para pruebas) ----------
@app.post("/eventos", status_code=201)
def recibir_evento(evento: dict):
	try:
		fuentes.aplicar_evento(evento)
	except ValueError as e:
		raise HTTPException(status_code=422, detail=str(e))
	return {"ok": True}


# ---------- Reportes ----------
@app.get("/reportes/resumen")
def reporte_resumen():
	return almacen.resumen()


@app.get("/reportes/ventas-por-dia")
def ventas_por_dia():
	return almacen.ventas_por_dia()


@app.get("/reportes/pagos")
def pagos_por_estado():
	return almacen.pagos_por_estado()


@app.get("/reportes/top-productos")
def top_productos():
	return almacen.top_productos()


@app.get("/reportes/pedidos-recientes")
def pedidos_recientes():
	return almacen.pedidos_recientes()


@app.get("/reportes/cliente/{cliente_id}")
def reporte_cliente(cliente_id: int):
	rep = almacen.reporte_cliente(cliente_id)
	if rep is None:                                  # no está en memoria: se pregunta a Clientes
		try:
			almacen.guardar_cliente(fuentes.traer_cliente(cliente_id))
		except fuentes.FuenteError as e:
			raise HTTPException(status_code=e.status, detail=e.detalle)
		rep = almacen.reporte_cliente(cliente_id)
	return rep
