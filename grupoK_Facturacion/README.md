# Facturación (FastAPI + MySQL + RabbitMQ, sin ORM) — Grupo 7

Microservicio que genera las facturas. Escucha el evento `PagoAprobado`, registra la factura,
la deja disponible en **PDF** y publica `FacturaGenerada`. Tiene su **propia base de datos**
(`facturacion`), una API de consulta y una interfaz web de solo lectura.
Sigue la misma estructura que el microservicio de Inventario.

## Ejecutar
    python -m venv .venv
    .venv\Scripts\Activate.ps1          # Linux/Mac: source .venv/bin/activate
    pip install -r requirements.txt
    copy .env.example .env              # Linux/Mac: cp .env.example .env
    uvicorn app.main:app --port 8007

Antes de arrancar:
1. Edita `.env` con tu contraseña de MySQL y la URL de RabbitMQ (CloudAMQP). **No subir `.env` a GitHub.**
2. Ejecuta `sql/schema.sql` en MySQL Workbench (**File → Open SQL Script…** y el rayo). Crea la
   base `facturacion` y la tabla `Factura`.

### ¿No tienes MySQL ni RabbitMQ? Usa Docker
    docker compose up -d

Levanta RabbitMQ (panel en http://localhost:15672, `guest` / `guest`) y un MySQL de pruebas en el
puerto **3307** con la base `facturacion` ya creada. En tu `.env` pon:

    DB_PORT=3307
    DB_PASSWORD=root
    RABBITMQ_URL=amqp://guest:guest@localhost:5672/%2F

## Páginas

| Ruta      | Descripción                                                   | Acceso  |
|-----------|---------------------------------------------------------------|---------|
| `/`       | Facturas generadas, con buscador y enlace al PDF              | Público |
| `/docs`   | Documentación interactiva de la API (Swagger)                 | Público |
| `/health` | Estado de la API, la base de datos y RabbitMQ                 | Público |

La interfaz se refresca sola cada 5 segundos y no permite editar: las facturas solo se crean al
procesar un `PagoAprobado`.

## Eventos (RabbitMQ)

| Elemento              | Valor                                                   |
|-----------------------|---------------------------------------------------------|
| Exchange de entrada   | `pagos_exchange` (fanout, del grupo de Pagos)           |
| Cola de este servicio | `cola_facturacion` (durable, enlazada al anterior)      |
| Exchange de salida    | `facturacion_exchange` (fanout, de este servicio)       |

Al ser fanout no se usan routing keys: el tipo de evento va en el campo `evento` del JSON.
Los demás grupos que quieran enterarse de las facturas (Notificaciones, Reportes) deben crear su
cola y enlazarla a `facturacion_exchange`.

### Qué hace al recibir `PagoAprobado`

1. Valida el mensaje (`pedidoId` y `total` son obligatorios).
2. Si el pedido ya tiene factura, **no crea otra**: reenvía el mismo `FacturaGenerada`.
3. Consulta al microservicio de **Clientes** (síncrono) el nombre y el correo del cliente.
   Si Clientes no responde, la factura se genera igual, sin esos datos.
4. Guarda la factura con número `FAC-AAAA-00001`.
5. Publica `FacturaGenerada` y confirma (`ack`) el mensaje original.

### Consume: `PagoAprobado`

```json
{
  "evento": "PagoAprobado",
  "pagoId": 501,
  "pedidoId": 1001,
  "clienteId": 25,
  "fecha": "2026-10-06T10:31:00",
  "total": 5000000,
  "productos": [
    { "productoId": 15, "cantidad": 2, "precio": 2500000 }
  ]
}
```

Obligatorios: `pedidoId` y `total`. Opcionales: `pagoId`, `clienteId` y `productos`
(sin `productos`, el PDF muestra solo el total).

### Publica: `FacturaGenerada`

```json
{
  "evento": "FacturaGenerada",
  "facturaId": 9001,
  "numeroFactura": "FAC-2026-09001",
  "pedidoId": 1001,
  "clienteId": 25,
  "fecha": "2026-10-06T10:31:05",
  "total": 5000000
}
```

> Un mensaje inválido (JSON roto, sin `pedidoId` o `total`) se descarta sin reintentos.
> Si MySQL falla, el mensaje vuelve a la cola y se reintenta.

# Consumo de la API

# API de Facturación

API de solo lectura para consultar las facturas.

## Endpoints

| Método | Ruta                                 | Autenticación |
|--------|--------------------------------------|---------------|
| `GET`  | `/api/facturas`                      | Ninguna       |
| `GET`  | `/api/facturas/{factura_id}`         | Ninguna       |
| `GET`  | `/api/facturas/pedido/{pedido_id}`   | Ninguna       |
| `GET`  | `/api/facturas/cliente/{cliente_id}` | Ninguna       |
| `GET`  | `/api/facturas/{factura_id}/pdf`     | Ninguna       |
| `GET`  | `/health`                            | Ninguna       |

`/api/facturas` y `/api/facturas/cliente/{cliente_id}` devuelven una lista (la más reciente
primero); las demás devuelven una sola factura. El PDF se genera al pedirlo, a partir de los datos
guardados.

## Respuestas

### 200 OK: factura encontrada (`GET /api/facturas/pedido/1001`)

```json
{
  "id": 1,
  "numero": "FAC-2026-00001",
  "pedido_id": 1001,
  "pago_id": 501,
  "cliente_id": 25,
  "cliente_nombre": "María José Pérez Gómez",
  "cliente_correo": "maria@correo.com",
  "fecha": "2026-10-06T10:31:05",
  "total": 5000000.0,
  "productos": [
    { "productoId": 15, "cantidad": 2, "precio": 2500000.0 }
  ]
}
```

`cliente_nombre` y `cliente_correo` son `null` si Clientes no respondió al facturar.

### 200 OK: PDF (`GET /api/facturas/1/pdf`)

Devuelve `application/pdf`.

### 200 OK: estado del servicio (`GET /health`)

```json
{
  "api": "ok",
  "base_de_datos": "ok",
  "rabbitmq": "ok"
}
```

`rabbitmq` muestra `desconectado` si el consumidor aún no conectó o perdió la conexión
(reintenta cada 5 segundos).

### 404 Not Found: la factura no existe

```json
{
  "detail": "Factura no encontrada"
}
```

### 422 Unprocessable Entity: petición inválida

Ocurre cuando el id de la ruta no es un número entero.

## Ejemplos de uso

### cURL

```bash
curl http://localhost:8007/api/facturas/pedido/1001
curl -o factura.pdf http://localhost:8007/api/facturas/1/pdf
```

### Python (requests)

```python
import requests

r = requests.get("http://localhost:8007/api/facturas/pedido/1001")
if r.status_code == 200:
    factura = r.json()
    print(factura["numero"], factura["total"])
elif r.status_code == 404:
    print("Ese pedido aún no tiene factura")
```

## Probar el flujo completo

El script publica un `PagoAprobado` **directo en `cola_facturacion`**, sin pasar por
`pagos_exchange`, para no molestar a los demás grupos. Arranca antes el servicio para que la
cola exista.

    python scripts/publicar_prueba.py 9001 15:2                  # factura con 2 unidades del producto 15
    python scripts/publicar_prueba.py 9001 15:2                  # repetido: NO crea otra factura
    python scripts/publicar_prueba.py 9002 15:1 16:3             # varios productos
    python scripts/publicar_prueba.py 9003 15:1 --sin-productos  # PagoAprobado sin lista de productos
    python scripts/publicar_prueba.py 9004 15:1 --cliente 99     # otro clienteId

Luego abre http://localhost:8007 y pulsa **Ver PDF**.

### Prueba de fallo

| Se apaga                | Qué ocurre                                                              |
|-------------------------|-------------------------------------------------------------------------|
| Facturación             | El mensaje espera en `cola_facturacion` y se factura al reiniciar       |
| Clientes                | La factura se genera igual, sin nombre ni correo                        |
| MySQL                   | El mensaje se reintenta cada 2 s hasta que MySQL vuelva                 |
| RabbitMQ                | La API sigue respondiendo; el consumidor reintenta cada 5 s             |

## Base de datos

Base propia `facturacion` (una BD por microservicio). Se crea con `sql/schema.sql`.

| Tabla     | Campos principales                                                              | Para qué sirve                                      |
|-----------|---------------------------------------------------------------------------------|-----------------------------------------------------|
| `Factura` | `id`, `numero`, `pedido_id` (único), `pago_id`, `cliente_id`, `cliente_nombre`, `cliente_correo`, `fecha`, `total`, `productos` (JSON) | Una factura por pedido; evita duplicados si el mensaje se repite |

## Variables de entorno

| Variable                        | Descripción                                   | Ejemplo                           |
|---------------------------------|-----------------------------------------------|-----------------------------------|
| `DB_HOST`, `DB_PORT`            | Servidor MySQL                                | `localhost`, `3306`               |
| `DB_USER`, `DB_PASSWORD`        | Credenciales de MySQL                         | `root`, (tu clave)                |
| `DB_NAME`                       | Base de datos del servicio                    | `facturacion`                     |
| `DB_SOCKET`                     | Socket Unix de MySQL (opcional)               | `/run/mysqld/mysqld.sock`         |
| `RABBITMQ_URL`                  | URL de CloudAMQP (`amqps://...`)              | no subir a GitHub                 |
| `RABBITMQ_EXCHANGE_PAGOS`       | Exchange de entrada                           | `pagos_exchange`                  |
| `RABBITMQ_EXCHANGE_FACTURACION` | Exchange de salida                            | `facturacion_exchange`            |
| `RABBITMQ_QUEUE`                | Cola propia                                   | `cola_facturacion`                |
| `CLIENTES_URL`                  | URL base del microservicio de Clientes        | `http://localhost:8000`           |

## Estructura

    app/main.py          API FastAPI + arranque del consumidor
    app/consumer.py      Conexión a RabbitMQ, consumo y publicación
    app/facturacion.py   Lógica: validar el pago, consultar al cliente y registrar la factura
    app/pdf.py           Genera la factura en PDF (fpdf2)
    app/db.py            Conexión a MySQL
    app/static/index.html  Interfaz (solo lectura)
    sql/schema.sql       Tabla Factura
    scripts/publicar_prueba.py  Simula un PagoAprobado
    docker-compose.yml   RabbitMQ y MySQL de pruebas

## Pendiente de acordar con otros grupos

- **Pagos:** nombre del exchange de salida (aquí se asume `pagos_exchange`) y si `PagoAprobado`
  incluirá `productos` y `clienteId`. Sin `productos`, el PDF muestra solo el total.
- **Notificaciones / Reportes:** enlazar su cola a `facturacion_exchange`. `FacturaGenerada` puede
  llegar repetido (si el servicio cae entre publicar y confirmar): deben ignorar un `facturaId` repetido.
- **Clientes:** este servicio llama a `POST /cliente` con `{"id": ...}`; confirmar la URL y el puerto.
