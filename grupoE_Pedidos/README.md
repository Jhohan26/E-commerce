# 📦 Microservicio de Pedidos

Servicio encargado de gestionar las órdenes de compra y publicar el evento **`PedidoCreado`** hacia los demás microservicios a través de **RabbitMQ**.

---

## 📡 Integración con RabbitMQ (Guía para los demás grupos)

### Configuración del Exchange

Para recibir los pedidos, tu microservicio debe conectarse a RabbitMQ usando estos parámetros:

| Parámetro | Valor |
|---|---|
| **Exchange** | `pedidos_exchange` |
| **Tipo** | `fanout` |
| **Durable** | `true` |
| **Routing Key** | `""` o `pedido.creado` *(el fanout lo distribuye a todas las colas enlazadas)* |

> ⚠️ **IMPORTANTE:** Cada microservicio debe declarar **su propia cola duradera** y enlazarla al exchange `pedidos_exchange`. Si dos servicios escuchan la misma cola, RabbitMQ repartirá los pedidos entre ellos y no los recibirán ambos.

### Colas recomendadas por microservicio

| Microservicio | Cola que debe declarar | Binding al Exchange |
|---|---|---|
| **Inventario** | `inventario_pedidos_queue` | `pedidos_exchange` |
| **Pagos** | `pagos_pedidos_queue` | `pedidos_exchange` |
| **Notificaciones** | `notificaciones_pedidos_queue` | `pedidos_exchange` |
| **Reportes** | `reportes_pedidos_queue` | `pedidos_exchange` |

*(Nota: la cola `pedidos_creados_auditoria` es de uso interno del módulo de Pedidos; ningún consumidor debe leerla).*

---

## 📜 Contrato del Evento: `PedidoCreado`

Cada vez que un cliente crea un pedido, RabbitMQ emitirá este mensaje en formato JSON:

```json
{
  "evento": "PedidoCreado",
  "pedidoId": 1001,
  "clienteId": 25,
  "fecha": "2026-10-01T10:30:00",
  "total": 5000000,
  "productos": [
    {
      "productoId": 15,
      "cantidad": 2,
      "precio": 2500000
    }
  ]
}
```

### Campos del JSON:
* `evento`: `"PedidoCreado"` *(string)*
* `pedidoId`: ID numérico único del pedido *(number)*
* `clienteId`: ID del cliente que realizó la compra *(number)*
* `fecha`: Fecha y hora de creación local en formato `YYYY-MM-DDTHH:mm:ss` *(string)*
* `total`: Monto total en COP *(number)*
* `productos`: Lista de productos comprados *(array)*
  * `productoId`: ID del producto en catálogo *(number)*
  * `cantidad`: Unidades solicitadas *(number)*
  * `precio`: Precio unitario congelado al comprar *(number)*

---

## 💻 Ejemplos de Consumidor (Copiar y pegar)

### 1. Node.js (`amqplib`)

```javascript
const amqp = require('amqplib');

const RABBITMQ_URL = 'amqps://...tu_url_de_cloudamqp...';
const EXCHANGE = 'pedidos_exchange';
const MI_COLA = 'inventario_pedidos_queue'; // Ajusta según tu microservicio

async function consumirPedidos() {
  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();

  await ch.assertExchange(EXCHANGE, 'fanout', { durable: true });
  await ch.assertQueue(MI_COLA, { durable: true });
  await ch.bindQueue(MI_COLA, EXCHANGE, '');
  await ch.prefetch(1);

  console.log(`[*] Esperando pedidos en "${MI_COLA}"...`);

  ch.consume(MI_COLA, (msg) => {
    if (!msg) return;
    const pedido = JSON.parse(msg.content.toString());

    console.log(`[✔] Pedido recibido: #${pedido.pedidoId} - Total: $${pedido.total}`);
    // ... procesar pedido aquí ...

    ch.ack(msg); // Confirmar mensaje
  });
}

consumirPedidos().catch(console.error);
```

### 2. Python (`pika`)

```python
import pika, json

RABBITMQ_URL = 'amqps://...tu_url_de_cloudamqp...'
EXCHANGE = 'pedidos_exchange'
MI_COLA = 'pagos_pedidos_queue' # Ajusta según tu microservicio

params = pika.URLParameters(RABBITMQ_URL)
connection = pika.BlockingConnection(params)
channel = connection.channel()

channel.exchange_declare(exchange=EXCHANGE, exchange_type='fanout', durable=True)
channel.queue_declare(queue=MI_COLA, durable=True)
channel.queue_bind(exchange=EXCHANGE, queue=MI_COLA, routing_key='')

def callback(ch, method, properties, body):
    pedido = json.loads(body.decode('utf-8'))
    print(f"[✔] Pedido recibido: #{pedido['pedidoId']} - Total: ${pedido['total']}")
    # ... procesar pedido aquí ...
    ch.basic_ack(delivery_tag=method.delivery_tag)

channel.basic_qos(prefetch_count=1)
channel.basic_consume(queue=MI_COLA, on_message_callback=callback)
print(f"[*] Esperando pedidos en {MI_COLA}...")
channel.start_consuming()
```

### 3. Java (Spring Boot)

```java
@Configuration
public class RabbitConfig {
    @Bean
    public FanoutExchange pedidosExchange() {
        return new FanoutExchange("pedidos_exchange", true, false);
    }

    @Bean
    public Queue miCola() {
        return new Queue("notificaciones_pedidos_queue", true);
    }

    @Bean
    public Binding binding(Queue miCola, FanoutExchange pedidosExchange) {
        return BindingBuilder.bind(miCola).to(pedidosExchange);
    }
}

@Component
public class PedidoListener {
    @RabbitListener(queues = "notificaciones_pedidos_queue")
    public void recibir(String json) {
        System.out.println("Pedido recibido: " + json);
    }
}
```

### 4. C# / .NET (`RabbitMQ.Client`)

```csharp
using System.Text;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

var factory = new ConnectionFactory { Uri = new Uri("amqps://...tu_url_de_cloudamqp...") };
using var conn = factory.CreateConnection();
using var ch = conn.CreateModel();

ch.ExchangeDeclare("pedidos_exchange", ExchangeType.Fanout, durable: true);
ch.QueueDeclare("reportes_pedidos_queue", durable: true, exclusive: false, autoDelete: false);
ch.QueueBind("reportes_pedidos_queue", "pedidos_exchange", "");

var consumer = new EventingBasicConsumer(ch);
consumer.Received += (model, ea) => {
    var json = Encoding.UTF8.GetString(ea.Body.ToArray());
    Console.WriteLine($"[✔] Pedido recibido: {json}");
    ch.BasicAck(ea.DeliveryTag, false);
};

ch.BasicConsume("reportes_pedidos_queue", autoAck: false, consumer: consumer);
Console.ReadLine();
```

---

## 🌐 Endpoints de la API REST

Base URL: `http://localhost:3000`

| Método | Endpoint | Descripción | Body / Parámetros |
|---|---|---|---|
| `GET` | `/api/health` | Estado del servicio (API, MySQL, RabbitMQ) | Ninguno |
| `GET` | `/api/pedidos` | Listar todos los pedidos | Query opcional: `?estado=PENDIENTE` |
| `GET` | `/api/pedidos/:id` | Detalle de un pedido con sus productos | Param: `id` |
| `POST` | `/api/pedidos` | Crear un pedido y publicar en RabbitMQ | JSON con `clienteId` y `productos` |
| `PUT` | `/api/pedidos/:id/estado` | Cambiar estado del pedido | JSON: `{ "estado": "PAGADO" }` |
| `POST` | `/api/pedidos/:id/reenviar-evento` | Reenviar evento a RabbitMQ manualmente | Param: `id` |

### Ejemplo: Crear pedido (`POST /api/pedidos`)

**Request:**
```json
{
  "clienteId": 25,
  "productos": [
    {
      "productoId": 15,
      "cantidad": 2,
      "precio": 2500000
    }
  ]
}
```

**Response (`201 Created`):**
```json
{
  "mensaje": "Pedido creado exitosamente y registrado en la base de datos.",
  "pedido": {
    "id": 1005,
    "clienteId": 25,
    "fecha": "2026-10-06T02:00:00",
    "total": 5000000,
    "estado": "PENDIENTE",
    "productos": [
      { "productoId": 15, "cantidad": 2, "precio": 2500000, "subtotal": 5000000 }
    ]
  },
  "rabbitmq": {
    "publicado": true,
    "detalle": "Evento PedidoCreado enviado exitosamente al Exchange de RabbitMQ."
  }
}
```

---

## 🚀 Puesta en Marcha Local

### 1. Variables de entorno (`.env`)

Crea un archivo `.env` en la raíz basado en `.env.example`:

```env
PORT=3000

# Base de datos MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_password
DB_NAME=pedidos_db

# RabbitMQ (CloudAMQP)
RABBITMQ_URL=amqps://...tu_instancia_cloudamqp...
RABBITMQ_EXCHANGE=pedidos_exchange
RABBITMQ_EXCHANGE_TYPE=fanout
RABBITMQ_ROUTING_KEY=pedido.creado
RABBITMQ_AUDIT_QUEUE=pedidos_creados_auditoria
```

### 2. Base de datos

Ejecuta el script [`database/schema.sql`](database/schema.sql) en MySQL Workbench para crear la base de datos `pedidos_db` y las tablas.

### 3. Instalar y ejecutar

```powershell
# Instalar paquetes
npm install

# Iniciar servidor
npm start
```

Abre **`http://localhost:3000`** en tu navegador.

### 4. Probar que RabbitMQ recibe los eventos

Con el servidor corriendo, abre otra terminal y ejecuta:

```powershell
npm run test-consumer
```

Crea un pedido desde la interfaz web o mediante `POST /api/pedidos` y verás el evento recibido en tiempo real con su `ACK`.

