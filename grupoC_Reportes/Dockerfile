# Imagen oficial y ligera de Python (misma versión que el .venv del grupo)
FROM python:3.13-slim

# Sin archivos .pyc y con logs inmediatos (se ven en "docker logs")
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencias primero para aprovechar la caché de capas de Docker
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Código de Reportes (el .env NO se copia: se pasa al ejecutar con --env-file o docker compose)
COPY *.py ./
COPY static/ ./static/

# Usuario sin privilegios; datos/ guarda el respaldo de pedidos y pagos (se monta como volumen)
RUN useradd --create-home reportes && mkdir -p datos && chown reportes datos
USER reportes

EXPOSE 8001

# El dashboard responde en /api/estado: Docker marca el contenedor como "healthy"
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/api/estado', timeout=4)"

# 0.0.0.0 para que se pueda abrir desde fuera del contenedor (iniciar.py usa 127.0.0.1 y no serviría aquí)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--timeout-graceful-shutdown", "2"]
