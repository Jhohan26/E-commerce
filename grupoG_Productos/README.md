# Consulta de productos vía CloudAMQP (RabbitMQ)

Documentación para consumir el catálogo de productos del **Grupo G - Productos** a través de colas en CloudAMQP, usando el patrón **RPC** (petición/respuesta).

## Cómo funciona

```
Cliente ──(petición + reply_to + correlation_id)──► Cola del worker
                                                         │
                                                    worker.py ──► MySQL (ecommerce_productos)
                                                         │
Cliente ◄──────(respuesta JSON, mismo correlation_id)────┘
```

1. El cliente publica un mensaje en una de las colas del worker e indica en `reply_to` la cola donde quiere la respuesta.
2. El worker consulta MySQL y publica el resultado en esa cola, con el mismo `correlation_id`.
3. El cliente recibe la respuesta y la identifica por su `correlation_id`.

> Si el mensaje no trae `reply_to`, el worker lo procesa pero **no responde**.

## Colas disponibles

| Cola | Cuerpo de la petición | Descripción |
|---|---|---|
| `producto.consultar` | `{"id": 1}` | Devuelve un producto por su id |
| `productos.listar` | *(vacío)* | Devuelve todos los productos ordenados por id |

Ambas colas son **durables** y las declara el worker al iniciar.

## Formato de las respuestas

Todas las respuestas son JSON con `content_type: application/json`.

### Éxito: un producto (`producto.consultar`)

```json
{
  "status": 200,
  "data": {
    "id": 1,
    "nombre": "Laptop",
    "precio": 2500000.0,
    "imagen_url": "img/laptop.jpg",
    "descripcion": "Laptop de 15 pulgadas",
    "categoria_id": 1,
    "categoria": "Electrónica"
  }
}
```

### Éxito: todos los productos (`productos.listar`)

```json
{
  "status": 200,
  "data": [
    { "id": 1, "nombre": "Laptop", "precio": 2500000.0, "imagen_url": "img/laptop.jpg", "descripcion": "...", "categoria_id": 1, "categoria": "Electrónica" },
    { "id": 2, "nombre": "Jean", "precio": 120000.0, "imagen_url": "img/jean.jpg", "descripcion": "...", "categoria_id": 2, "categoria": "Ropa" }
  ]
}
```

*(Los valores son de ejemplo; los datos reales dependen de lo que haya en la base de datos.)*

### Errores

```json
{ "status": 404, "error": "Producto no encontrado" }
```

| `status` | Cuándo ocurre |
|---|---|
| `200` | Consulta exitosa |
| `400` | El cuerpo no es un JSON válido o no trae `id` numérico. Se espera `{"id": 1}` |
| `404` | No existe un producto con ese `id` |
| `500` | Error interno del worker (por ejemplo, falla la conexión a MySQL) |

### Campos del producto

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | número | Identificador del producto |
| `nombre` | texto | Nombre del producto |
| `precio` | número | Precio (el worker convierte el `DECIMAL(12,2)` de MySQL a número) |
| `imagen_url` | texto o `null` | Ruta o URL de la imagen |
| `descripcion` | texto o `null` | Descripción del producto |
| `categoria_id` | número | Id de la categoría |
| `categoria` | texto | Nombre de la categoría |

## Configuración

Variables de entorno (archivo `.env`):

| Variable | Descripción | Obligatoria |
|---|---|---|
| `CLOUDAMQP_URL` | URL de conexión de la instancia, formato `amqps://usuario:password@host/vhost` (se copia desde el panel de CloudAMQP) | Sí |
| `DB_HOST` | Host de MySQL | Solo worker |
| `DB_USER` | Usuario de MySQL | Solo worker |
| `DB_PASSWORD` | Contraseña de MySQL | Solo worker |
| `DB_NAME` | Base de datos (`ecommerce_productos`) | Solo worker |
| `DB_PORT` | Puerto de MySQL (por defecto `3306`) | No |

Quien **solo consume** los productos únicamente necesita `CLOUDAMQP_URL`.

## Puesta en marcha del worker

```bash
pip install -r requirements.txt
cp .env.example .env      # completar los valores
python worker.py
```

Al iniciar debe mostrar:

```
Worker listo. Escuchando: producto.consultar, productos.listar
```

Si se pierde la conexión con CloudAMQP, el worker reintenta cada 5 segundos.

## Consumir los productos

### Opción 1: desde la terminal con `cliente_rpc.py`

```bash
python cliente_rpc.py        # lista todos los productos
python cliente_rpc.py 1      # consulta el producto con id 1
```

### Opción 2: desde código Python

```python
from cliente_rpc import ClienteRPC

rpc = ClienteRPC()
try:
    respuesta = rpc.consultar_producto(1)
    if respuesta["status"] == 200:
        print(respuesta["data"]["nombre"], respuesta["data"]["precio"])
    else:
        print("Error:", respuesta["error"])

    todos = rpc.listar_productos()
    for p in todos["data"]:
        print(p["id"], p["nombre"], p["categoria"])
finally:
    rpc.cerrar()
```

Si el worker no responde en 10 segundos (valor por defecto), `llamar()` lanza `TimeoutError`.

### Opción 3: desde cualquier otro lenguaje

Basta con respetar el contrato:

1. Conectarse a CloudAMQP con la URL de la instancia.
2. Crear una cola de respuesta exclusiva (nombre generado por el servidor).
3. Publicar en `producto.consultar` o `productos.listar` con las propiedades:
   - `reply_to` = nombre de la cola de respuesta
   - `correlation_id` = un identificador único (por ejemplo, un UUID)
4. Leer la cola de respuesta y quedarse con el mensaje cuyo `correlation_id` coincida.

Ejemplo de referencia en Node.js con `amqplib`:

```javascript
const amqp = require('amqplib');
const { randomUUID } = require('crypto');

async function consultarProducto(id) {
    const conn = await amqp.connect(process.env.CLOUDAMQP_URL);
    const ch = await conn.createChannel();
    const { queue } = await ch.assertQueue('', { exclusive: true });
    const corrId = randomUUID();

    const respuesta = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), 10000);
        ch.consume(queue, (msg) => {
            if (msg.properties.correlationId === corrId) {
                clearTimeout(timer);
                resolve(JSON.parse(msg.content.toString()));
            }
        }, { noAck: true });
    });

    ch.sendToQueue('producto.consultar', Buffer.from(JSON.stringify({ id })), {
        replyTo: queue,
        correlationId: corrId,
    });

    try {
        return await respuesta;
    } finally {
        await conn.close();
    }
}

consultarProducto(1).then(console.log);
```

Para listar todos los productos, se publica en `productos.listar` con cuerpo vacío (`Buffer.alloc(0)`).

## Probar manualmente desde el panel de CloudAMQP

1. Abrir el **RabbitMQ Manager** de la instancia.
2. En **Queues**, crear una cola de respuesta, por ejemplo `respuestas.prueba`.
3. Entrar a la cola `producto.consultar` → **Publish message**.
4. En **Properties**, agregar `reply_to = respuestas.prueba` y `correlation_id = prueba-1`.
5. En **Payload**, escribir `{"id": 1}` y publicar.
6. Entrar a `respuestas.prueba` → **Get messages** para ver la respuesta del worker.

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| `TimeoutError: El worker no respondió a tiempo` | El worker no está corriendo, o el mensaje se publicó sin `reply_to` |
| `KeyError: 'CLOUDAMQP_URL'` | Falta la variable en el `.env` |
| Respuesta `400` | El cuerpo no es `{"id": <número>}` |
| Respuesta `404` | El producto no existe en la base de datos |
| Respuesta `500` | Revisar los logs del worker; normalmente es la conexión a MySQL o las variables `DB_*` |
| El mensaje queda en la cola sin consumirse | El worker está caído; al volver a iniciar procesará los mensajes pendientes que no hayan caducado |

> Las peticiones de `cliente_rpc.py` caducan a los 10 segundos (`expiration`). Si el worker está caído, el mensaje se descarta solo. Los clientes que no definan `expiration` dejarán el mensaje en la cola hasta que el worker vuelva.