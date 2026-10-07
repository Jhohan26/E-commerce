"""Simulador del microservicio de Clientes (Grupo F), SOLO para pruebas locales.

Mismo contrato que grupoF_Clientes/main.py: POST /cliente {"id": N}
-> 200 con los datos del cliente, o 404 {"detail": "Cliente no encontrado"}.
No usa base de datos. Los datos son FALSOS: no los uses en el reporte real.

Ejecutar (puerto 8000, como Clientes):
    uvicorn pruebas.clientes_simulado:app --port 8000
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Clientes (SIMULADO)")

CLIENTES = {
	1: dict(id=1, primer_nombre="Jhohan", segundo_nombre="Esteban", primer_apellido="Reyes",
			segundo_apellido=None, correo="jhohan@gmail.com", estado=1),
	2: dict(id=2, primer_nombre="Ana", segundo_nombre=None, primer_apellido="Prueba",
			segundo_apellido="Simulada", correo="ana.simulada@example.com", estado=1),
}


class ConsultaCliente(BaseModel):
	id: int


@app.post("/cliente")
def api_cliente(consulta: ConsultaCliente):
	if consulta.id not in CLIENTES:
		raise HTTPException(status_code=404, detail="Cliente no encontrado")
	return CLIENTES[consulta.id]
