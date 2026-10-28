# Facturacion (FastAPI + consumidor RabbitMQ en el mismo proceso)
#   docker build -t facturacion-app:1.0 .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts

# Sin root dentro del contenedor
RUN useradd --system --uid 10001 --no-create-home appuser
USER appuser

EXPOSE 8007
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8007"]
