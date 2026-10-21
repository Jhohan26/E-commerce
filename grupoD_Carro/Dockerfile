# Carrito de compras (Grupo D) - FastAPI + RabbitMQ (CloudAMQP)
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencias primero: la capa se reutiliza mientras requirements.txt no cambie.
COPY requirements.txt .
RUN pip install -r requirements.txt

# Solo el código de la aplicación. NO se copia .env ni secretos (ver .dockerignore):
# la configuración llega por variables de entorno en tiempo de ejecución.
COPY main.py api.py auth.py rabbit.py productos.py ./
COPY templates ./templates

# Usuario sin privilegios. /app debe ser escribible porque productos.py guarda
# catalogo_cache.json junto al código (copia local del último catálogo conocido).
RUN useradd --system --uid 10001 --no-create-home appuser \
    && chown -R appuser:appuser /app
USER 10001

EXPOSE 8000

# Usa /health (no toca RabbitMQ). Kubernetes define sus propias sondas en k8s/deployment.yaml.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).status == 200 else 1)"]

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
