# Inventario (FastAPI + MySQL + RabbitMQ, sin ORM)

Microservicio que controla las existencias. Escucha el evento `PedidoCreado`, descuenta las
unidades y publica el resultado. Tiene su **propia base de datos** (`inventario`), una API de
consulta y una interfaz web de solo lectura.

## Ejecutar
    python -m venv .venv
    .venv\Scripts\Activate.ps1          # Linux/Mac: source .venv/bin/activate
    pip install -r requirements.txt
    pip install cryptography
    copy .env.example .env              # Linux/Mac: cp .env.example .env
    uvicorn app.main:app --port 8005

Antes de arrancar:
1. Edita `.env` con tu contraseña de MySQL y la URL de RabbitMQ (CloudAMQP). **No subir `.env` a GitHub.**
2. Ejecuta `sql/schema.sql` en MySQL Workbench (**File → Open SQL Script…** y el rayo). Crea la
   base `inventario`, las tablas y 5 productos de ejemplo.

## Páginas

| Ruta      | Descripción                                                   | Acceso  |
|-----------|---------------------------------------------------------------|---------|
| `/`       | Productos del inventario y sus cantidades (solo lectura)      | Público |
| `/docs`   | Documentación interactiva de la API (Swagger)                 | Público |
| `/health` | Estado de la API, la base de datos y RabbitMQ                 | Público |

La interfaz se refresca sola cada 5 segundos, tiene buscador y marca cada producto como
**Disponible**, **Stock bajo** (por debajo de `STOCK_BAJO`, por defecto 10) o **Agotado**.
No permite editar: el stock solo cambia al procesar un `PedidoCreado`.

## Eventos (RabbitMQ)

| Elemento             | Valor                                              |
|----------------------|----------------------------------------------------|
| Exchange de entrada  | `pedidos_exchange` (fanout, del grupo de Pedidos)  |
| Cola de este servicio| `cola_inventario` (durable, enlazada al anterior)  |
| Exchange de salida   | `inventario_exchange` (fanout, de este servicio)   |

Al ser fanout no se usan routing keys: el tipo de evento va en el campo `evento` del JSON.
Los demás grupos que quieran enterarse del resultado deben crear su cola y enlazarla a
`inventario_exchange`.

### Qué hace al recibir `PedidoCreado`

1. Identifica los productos del pedido (suma cantidades si uno se repite).
2. Consulta las existencias en `Inventario`.
3. Verifica la disponibilidad de **todos** los productos.
4. Descuenta las unidades (todo o nada, en una sola transacción).
5. Genera un nuevo evento: `InventarioActualizado` o `InventarioInsuficiente`.

Un pedido ya procesado (mismo `pedidoId`) no se descuenta de nuevo: se reenvía el mismo evento.

### Consume: `PedidoCreado`

```json
{
  "evento": "PedidoCreado",
  "pedidoId": 1003,
  "clienteId": 1,
  "fecha": "2026-10-06T03:35:50",
  "total": 300,
  "productos": [
    { "productoId": 2, "cantidad": 1, "precio": 300 }
  ]
}
```

### Publica: `InventarioActualizado` (stock descontado)

```json
{
  "evento": "InventarioActualizado",
  "pedidoId": 1003,
  "clienteId": 1,
  "fecha": "2026-10-06T03:35:52",
  "productos": [
    { "productoId": 2, "cantidad": 1 }
  ]
}
```

### Publica: `InventarioInsuficiente` (no se descontó nada)

```json
{
  "evento": "InventarioInsuficiente",
  "pedidoId": 1004,
  "clienteId": 1,
  "fecha": "2026-10-06T03:40:10",
  "faltantes": [
    { "productoId": 2, "solicitado": 20, "disponible": 8 }
  ]
}
```

> Un producto que no existe en `Inventario` se trata como 0 unidades y aparece en `faltantes`.

# Consumo de la API

# API de Inventario

API de solo lectura para consultar las existencias.

## Endpoints

| Método | Ruta                            | Autenticación |
|--------|---------------------------------|---------------|
| `GET`  | `/api/inventario`               | Ninguna       |
| `GET`  | `/api/inventario/{producto_id}` | Ninguna       |
| `GET`  | `/health`                       | Ninguna       |

**La ruta `/api/inventario` devuelve una lista con la información de todos los productos, de la
misma manera que `/api/inventario/{producto_id}` para uno solo.**

## Petición

No lleva cuerpo. Solo el `producto_id` en la ruta cuando se consulta un producto.

| Parámetro     | Tipo   | Requerido | Descripción                   |
|---------------|--------|-----------|-------------------------------|
| `producto_id` | entero | Sí        | Identificador del producto    |

## Respuestas

### 200 OK: producto encontrado (`GET /api/inventario/15`)

```json
{
  "producto_id": 15,
  "nombre": "Portátil 14\"",
  "cantidad": 8,
  "actualizado": "2026-10-06T03:35:52"
}
```

| Campo         | Tipo           | Descripción                                  |
|---------------|----------------|----------------------------------------------|
| `producto_id` | entero         | Identificador del producto                   |
| `nombre`      | texto o `null` | Nombre del producto (opcional)               |
| `cantidad`    | entero         | Unidades disponibles (nunca negativo)        |
| `actualizado` | fecha y hora   | Último cambio de la cantidad                 |

### 200 OK: lista (`GET /api/inventario`)

```json
[
  { "producto_id": 15, "nombre": "Portátil 14\"", "cantidad": 8, "actualizado": "2026-10-06T03:35:52" },
  { "producto_id": 16, "nombre": "Mouse inalámbrico", "cantidad": 50, "actualizado": "2026-10-05T20:10:00" }
]
```

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

### 404 Not Found: el producto no existe

```json
{
  "detail": "Producto no encontrado en el inventario"
}
```

### 422 Unprocessable Entity: petición inválida

Ocurre cuando `producto_id` no es un número entero.

```json
{
  "detail": [
    {
      "type": "int_parsing",
      "loc": ["path", "producto_id"],
      "msg": "Input should be a valid integer, unable to parse string as an integer",
      "input": "abc"
    }
  ]
}
```

## Ejemplos de uso

### cURL

```bash
curl http://localhost:8005/api/inventario/15
```

### Python (requests)

```python
import requests

respuesta = requests.get("http://localhost:8005/api/inventario/15")

if respuesta.status_code == 200:
    producto = respuesta.json()
    print(producto["nombre"], producto["cantidad"])
elif respuesta.status_code == 404:
    print("El producto no existe en el inventario")
else:
    print("Error:", respuesta.status_code, respuesta.text)
```

### JavaScript (fetch)

```javascript
const respuesta = await fetch("http://localhost:8005/api/inventario/15");

if (respuesta.ok) {
  const producto = await respuesta.json();
  console.log(producto);
} else if (respuesta.status === 404) {
  console.log("El producto no existe en el inventario");
}
```

## Documentación interactiva

FastAPI genera documentación automática donde puedes probar los endpoints desde el navegador:

- Swagger UI: `http://localhost:8005/docs`
- ReDoc: `http://localhost:8005/redoc`

## Probar el flujo completo

El script publica un `PedidoCreado` **directo en `cola_inventario`**, sin pasar por
`pedidos_exchange`, para no molestar a los demás grupos. Arranca antes el servicio para que la
cola exista.

    python scripts/publicar_prueba.py 9001 15:2        # descuenta 2 unidades del producto 15
    python scripts/publicar_prueba.py 9002 15:500      # sin stock: InventarioInsuficiente
    python scripts/publicar_prueba.py 9001 15:2        # repetido: no descuenta de nuevo

## Base de datos

Base propia `inventario` (una BD por microservicio). Se crea con `sql/schema.sql`.

| Tabla             | Campos                                                  | Para qué sirve                                   |
|-------------------|---------------------------------------------------------|--------------------------------------------------|
| `Inventario`      | `producto_id`, `nombre`, `cantidad`, `actualizado`      | Existencias por producto                         |
| `PedidoProcesado` | `pedido_id`, `resultado`, `evento_json`, `procesado_en` | Evita descontar dos veces si el mensaje se repite|

Para dar de alta o reponer un producto:

```sql
INSERT INTO inventario.Inventario (producto_id, nombre, cantidad)
VALUES (2, 'Producto 2', 50)
ON DUPLICATE KEY UPDATE cantidad = VALUES(cantidad);
```

## Variables de entorno

| Variable                       | Descripción                                   | Ejemplo                           |
|--------------------------------|-----------------------------------------------|-----------------------------------|
| `DB_HOST`, `DB_PORT`           | Servidor MySQL                                | `localhost`, `3306`               |
| `DB_USER`, `DB_PASSWORD`       | Credenciales de MySQL                         | `root`, (tu clave)                |
| `DB_NAME`                      | Base de datos del servicio                    | `inventario`                      |
| `RABBITMQ_URL`                 | URL de CloudAMQP (`amqps://...`)              | no subir a GitHub                 |
| `RABBITMQ_EXCHANGE_PEDIDOS`    | Exchange de entrada                           | `pedidos_exchange`                |
| `RABBITMQ_EXCHANGE_INVENTARIO` | Exchange de salida                            | `inventario_exchange`             |
| `RABBITMQ_QUEUE`               | Cola propia                                   | `cola_inventario`                 |
| `STOCK_BAJO`                   | Unidades para marcar "Stock bajo"             | `10`                              |

## Estructura

    app/main.py          API FastAPI + arranque del consumidor
    app/consumer.py      Conexión a RabbitMQ, consumo y publicación
    app/inventario.py    Lógica: validar, verificar y descontar stock
    app/db.py            Conexión a MySQL
    app/static/index.html  Interfaz (solo lectura)
    sql/schema.sql       Tablas y datos de ejemplo
    scripts/publicar_prueba.py  Simula un PedidoCreado

## Pendiente de acordar con otros grupos

- **Pagos / Notificaciones / Reportes:** formato de `InventarioActualizado` e
  `InventarioInsuficiente` y enlazar su cola a `inventario_exchange`.
- **Productos:** qué `productoId` se manejan y quién carga el stock inicial.
- **Compensación:** si el pago es rechazado, ¿quién devuelve el stock? No está implementado.
