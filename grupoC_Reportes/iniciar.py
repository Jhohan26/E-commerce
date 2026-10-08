"""Arranca Reportes con recarga automática. Uso:  python iniciar.py

Equivale a `uvicorn main:app --reload --port 8001`, pero con un límite de 2 s para cerrar las conexiones
en vivo del dashboard al recargar o detener (sin él, el servidor puede quedarse colgado)."""
import uvicorn

if __name__ == "__main__":
	uvicorn.run("main:app", host="127.0.0.1", port=8001, reload=True, timeout_graceful_shutdown=2)
