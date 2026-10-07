# Inventario (FastAPI + MySQL + RabbitMQ, sin ORM)

Microservicio que controla las existencias. Escucha el evento `PedidoCreado`, descuenta las
unidades y publica el resultado. Tiene su **propia base de datos** (`inventario`), una API de
consulta y una interfaz web. Las cantidades **solo se pueden editar desde el equipo donde corre
este módulo**; el resto de los grupos únicamente consulta.

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
   base `inventario` y las tablas.

Para que otros computadores de la red consulten la API, arranca con:

    uvicorn app.main:app --host 0.0.0.0 --port 8005

## Páginas

| Ruta      | Descripción                                                              | Acceso                             |
|-----------|--------------------------------------------------------------------------|------------------------------------|
| `/`       | Productos y cantidades. En el equipo del módulo permite editar la cantidad | Consulta pública, edición solo local |
| `/docs`   | Documentación interactiva de la API (Swagger)                            | Público                            |
| `/health` | Estado de la API, la base de datos y RabbitMQ                            | Público                            |

La página se refresca sola cada 5 segundos, tiene buscador y marca cada producto como
**Disponible**, **Stock bajo** (por debajo de `STOCK_BAJO`, por defecto 10) o **Agotado**.

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

Se publica cuando la cantidad pedida supera el stock de algún producto.

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

API para consultar las existencias, y un único endpoint de edición restringido al equipo local.

## Endpoints

| Método | Ruta                            | Autenticación                  |
|--------|---------------------------------|--------------------------------|
| `GET`  | `/api/inventario`               | Ninguna                        |
| `GET`  | `/api/inventario/{producto_id}` | Ninguna                        |
| `GET`  | `/health`                       | Ninguna                        |
| `GET`  | `/api/admin/estado`             | Ninguna                        |
| `PUT`  | `/api/admin/inventario/{producto_id}` | Solo desde el equipo local |

**La ruta `/api/inventario` devuelve una lista con la información de todos los productos, de la
misma manera que `/api/inventario/{producto_id}` para uno solo.**

## Petición de consulta

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

## Edición de cantidades (solo desde el módulo)

Solo este módulo puede modificar las cantidades. Los demás grupos únicamente **consultan** (`GET`).

La edición se hace en la misma página `/`: al abrirla en el equipo donde corre el servicio
(`http://localhost:8005/`) aparecen las columnas **Nueva cantidad**, **Motivo** y **Guardar**. Desde
cualquier otro computador la página es de solo lectura.

- `GET /api/admin/estado` responde `{"editable": true}` solo en el equipo local; la página lo usa para
  decidir si muestra los campos de edición.
- `PUT /api/admin/inventario/{producto_id}` fija la cantidad. Si la petición no viene del equipo
  local responde `403`, aunque alguien intente llamarlo directamente.

Cuerpo de `PUT`:

```json
{ "cantidad": 40, "motivo": "Recuento físico" }
```

| Campo      | Tipo   | Requerido | Descripción                                        |
|------------|--------|-----------|----------------------------------------------------|
| `cantidad` | entero | Sí        | Nueva cantidad (mayor o igual a 0)                 |
| `motivo`   | texto  | No        | Razón del cambio (máx. 200). Por defecto `Recuento` |

Respuestas: `200` con el producto actualizado, `403` si no es el equipo local, `404` si el producto
no existe y `422` si la cantidad es inválida (por ejemplo negativa).

Cada ajuste queda registrado en la tabla `MovimientoInventario` (cantidad anterior, nueva, motivo y
fecha):

```sql
SELECT * FROM inventario.MovimientoInventario ORDER BY id DESC;
```

> Esta restricción protege contra otros computadores; no protege si alguien usa el mismo equipo
> donde corre el servicio. Entra con `localhost`: con la dirección IP del propio equipo la edición
> tampoco se habilita.

## Pedidos consulta las existencias

Pedidos usa `GET /api/inventario` o `GET /api/inventario/{producto_id}` para impedir, desde su
interfaz, un pedido superior a las existencias. Si aun así llega un `PedidoCreado` que supera el
stock, Inventario no descuenta nada y publica `InventarioInsuficiente` con los `faltantes`
(cantidad solicitada y disponible).

## Probar el flujo completo

El script publica un `PedidoCreado` **directo en `cola_inventario`**, sin pasar por
`pedidos_exchange`, para no molestar a los demás grupos. Arranca antes el servicio para que la
cola exista.

    python scripts/publicar_prueba.py 9001 15:2        # descuenta 2 unidades del producto 15
    python scripts/publicar_prueba.py 9002 15:500      # sin stock: InventarioInsuficiente
    python scripts/publicar_prueba.py 9001 15:2        # repetido: no descuenta de nuevo

## Probar con otra persona

1. Arrancar con `uvicorn app.main:app --host 0.0.0.0 --port 8005`.
2. Averiguar la IP con `ipconfig` (línea **Dirección IPv4** del adaptador Wi-Fi).
3. Marcar la red Wi-Fi como **Privada** en Windows y permitir el acceso de Python en el firewall.
4. La otra persona abre `http://IP_DEL_EQUIPO:8005/` (debe estar en la misma red).
5. Debe ver la tabla **sin** campos de edición; un `PUT` desde su equipo responde `403`.

## Tolerancia a fallos

El servicio está desacoplado del resto por RabbitMQ: si Inventario se apaga, **el sistema sigue
funcionando** y los demás servicios no se enteran. Pedidos publica `PedidoCreado` sin esperar respuesta.

| Situación                  | Qué pasa                                                                                         |
|----------------------------|--------------------------------------------------------------------------------------------------|
| Inventario apagado         | Los pedidos se acumulan en `cola_inventario` (durable). Al volver, los procesa en orden.         |
| Cae MySQL                  | El mensaje vuelve a la cola y se reintenta cada 2 s. No se pierde ni se descuenta a medias.      |
| Cae RabbitMQ               | El consumidor reintenta la conexión cada 5 s. La API de consulta sigue respondiendo.             |
| Mensaje repetido           | `PedidoProcesado` evita descontar dos veces: se reenvía el mismo evento de respuesta.            |
| Mensaje inválido           | Se descarta con un log de error; no bloquea la cola.                                             |
| Falta stock en un producto | No se descuenta nada del pedido y se publica `InventarioInsuficiente`.                           |

Mientras Inventario está apagado no se publican los eventos de salida (`InventarioActualizado` /
`InventarioInsuficiente`), así que los servicios que dependen de ellos esperan hasta que vuelva.

### Demostración

1. Con el servicio corriendo, detenerlo con **Ctrl + C**.
2. Enviar un pedido de prueba:

       python scripts/publicar_prueba.py 9100 15:1

3. En el panel de RabbitMQ, `cola_inventario` muestra **Ready: 1** (el pedido espera).
4. Volver a arrancar: `uvicorn app.main:app --port 8005`.
5. En el log aparece `Pedido 9100 -> InventarioActualizado`, la cola vuelve a 0 y el producto 15 baja una unidad.

## Base de datos

Base propia `inventario` (una BD por microservicio). Se crea con `sql/schema.sql`.

| Tabla                  | Campos                                                                      | Para qué sirve                                    |
|------------------------|-----------------------------------------------------------------------------|---------------------------------------------------|
| `Inventario`           | `producto_id`, `nombre`, `cantidad`, `actualizado`                          | Existencias por producto                          |
| `PedidoProcesado`      | `pedido_id`, `resultado`, `evento_json`, `procesado_en`                     | Evita descontar dos veces si el mensaje se repite |
| `MovimientoInventario` | `producto_id`, `tipo`, `cantidad_anterior`, `cantidad_nueva`, `motivo`, `fecha` | Historial de ajustes manuales de cantidad     |

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
    app/inventario.py    Lógica: validar, verificar, descontar y ajustar stock
    app/db.py            Conexión a MySQL
    app/static/index.html  Interfaz (consulta; edición solo en el equipo local)
    sql/schema.sql       Tablas
    scripts/publicar_prueba.py  Simula un PedidoCreado

## Pendiente de acordar con otros grupos

- **Productos:** Inventario debería recibir de Productos el ID y el nombre de cada producto
  nuevo (propuesta: evento `ProductoCreado` con `productoId` y `nombre`). Por ahora los
  productos se cargan con el `INSERT` de la sección Base de datos.
- **Pedidos:** dirección y puerto desde donde consultarán esta API.
- **Pagos / Notificaciones / Reportes:** formato de `InventarioActualizado` e
  `InventarioInsuficiente` y enlazar su cola a `inventario_exchange`.
- **Compensación:** si el pago es rechazado, ¿quién devuelve el stock? No está implementado.
