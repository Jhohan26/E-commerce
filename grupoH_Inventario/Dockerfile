FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# Código (el .dockerignore deja fuera .venv, .env y usuarios.json)
COPY app ./app
COPY worker_inventario.py ./
COPY scripts ./scripts

EXPOSE 8005

# Por defecto: API + interfaz web. El worker sobrescribe el comando en docker-compose.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8005"]
