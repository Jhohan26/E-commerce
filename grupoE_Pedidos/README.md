# 📦 Microservicio de Pedidos (Grupo E)

Servicio encargado de gestionar las órdenes de compra, validar acceso mediante **JWT y roles (`cliente`, `operador`, `administrador`)**, consumir respuestas de **Carrito, Clientes, Productos, Pagos e Inventario**, y publicar el evento **`PedidoCreado`** hacia los demás microservicios a través de **RabbitMQ**.

---

## 🔐 Autenticación JWT y Control de Acceso por Roles

El microservicio protege sus endpoints mediante tokens **Bearer JWT (`HS256`)** firmados con el secreto compartido del clúster (`JWT_SECRET`), siendo totalmente compatible con los tokens emitidos por **Clientes (`auth.login` - Grupo F)** y **Pagos (Grupo B)**.

### Roles soportados
| Rol | Permisos en el Microservicio de Pedidos |
|---|---|
| **`cliente`** | Puede crear pedidos únicamente para su propio `clienteId` y consultar solo sus propios pedidos (`GET /api/pedidos/mios`, `GET /api/pedidos`, `GET /api/pedidos/:id`). Recibe `403 Forbidden` si intenta ver pedidos de otro cliente o cambiar estados. |
| **`operador`** | Puede consultar todos los pedidos, crear pedidos para cualquier cliente, actualizar el estado (`PUT /api/pedidos/:id/estado`) y reenviar eventos a RabbitMQ. |
| **`administrador`** | Acceso total a todas las operaciones administrativas y operativas del microservicio. |

---

## 🌐 Endpoints de la API REST

Base URL: `http://localhost:3000`

| Método | Endpoint | Acceso / Rol Requerido | Descripción |
|---|---|---|---|
| `GET` | `/api/health` | **Público** (Sin token) | Estado de salud del servicio (`API`, `MySQL`, `RabbitMQ`) para probes de Kubernetes |
| `GET` | `/api/productos` | **Público** (Sin token) | Catálogo de productos (sincronizado vía RPC con Grupo G) |
| `GET` | `/api/clientes` | **Público** | Listado de clientes obtenidos vía RabbitMQ RPC desde Grupo F (con `auth.login` JWT) |
| `POST` | `/api/auth/token` | **Público** | Emite tokens JWT de prueba por rol (`cliente`, `operador`, `administrador` o `vencido: true`) |
| `GET` | `/api/auth/me` | **JWT** (`cliente`, `operador`, `administrador`) | Verifica el token enviado y devuelve los claims decodificados |
| `GET` | `/api/pedidos` | **JWT** (`cliente` ve solo los suyos; `operador`/`administrador` ven todos) | Lista los pedidos registrados |
| `GET` | `/api/pedidos/mios` | **JWT** (`cliente`, `operador`, `administrador`) | Lista exclusivamente los pedidos asociados al `clienteId` del token |
| `GET` | `/api/pedidos/:id` | **JWT** (`cliente` propietario, `operador`, `administrador`) | Detalle de un pedido con sus productos y motivo de cancelación |
| `POST` | `/api/pedidos` | **JWT** (`cliente` propio, `operador`, `administrador`) | Crea un pedido en MySQL y publica `PedidoCreado` en RabbitMQ |
| `PUT` | `/api/pedidos/:id/estado` | **JWT** (**Solo `operador` y `administrador`**) | Cambia el estado del pedido (`PAGADO`, `CANCELADO`, etc.) y registra `motivo` |
| `POST` | `/api/pedidos/:id/reenviar-evento` | **JWT** (**Solo `operador` y `administrador`**) | Reenvía manualmente el evento `PedidoCreado` a RabbitMQ |

### Pruebas en Postman (Los 7 casos del Laboratorio)
En la carpeta [`postman/Pedidos_JWT_Postman_Collection.json`](postman/Pedidos_JWT_Postman_Collection.json) se incluye la colección lista para importar en Postman con:
1. Emisión automática de tokens (`cliente`, `operador`, `administrador` y token vencido).
2. Los **7 casos obligatorios de prueba** (`200 OK` público, `401` sin token, `200` con token válido, `401` token alterado, `401` token vencido, `403` rol no autorizado y `201` rol autorizado).

---

## 🗄️ Base de Datos y Carga Automática del Dump (`database/schema.sql`)

El microservicio cuenta con **inicialización y carga de dump 100% automática**:
1. El archivo [`database/schema.sql`](database/schema.sql) contiene tanto la estructura de las tablas (`pedidos` y `pedido_items`) como el **dump de datos reales** de prueba.
2. Al arrancar el microservicio ([`src/config/db.js`](src/config/db.js)):
   - Ejecuta automáticamente `CREATE DATABASE IF NOT EXISTS pedidos_db` y crea las tablas si no existen.
   - Si detecta que la base de datos está recién creada (0 registros), **importa automáticamente todos los pedidos y detalles del dump `database/schema.sql`**.
   - Si el host primario (`host.docker.internal`) no tiene un servidor MySQL local corriendo, hace **fallback automático** al contenedor interno `pedidos-mysql` desplegado en Docker/Kubernetes.

---

## 🐳 Ejecución con Docker y Docker Compose (Todo incluido: MySQL + Pedidos)

### Opción A: Levantar todo (Base de datos MySQL con Dump + Microservicio de Pedidos) con Docker Compose
Ideal si quieres levantar el módulo completo con su propia base de datos MySQL en un solo comando sin instalar MySQL en tu máquina:

```powershell
docker compose up -d --build
```
- Esto levanta el contenedor **`pedidos-mysql` (`mysql:8.0`)** cargando automáticamente el dump [`database/schema.sql`](database/schema.sql) y el contenedor **`pedidos-web`** en `http://localhost:3000`.

### Opción B: Construir únicamente la imagen Docker del microservicio
```powershell
docker build -t pedidos:lab-jwt-v1 .
```

---

## ☸️ Orquestación con Kubernetes (Namespace `ecommerce`)

Los manifiestos se encuentran en la carpeta [`k8s/`](k8s/):
- [`k8s/pedidos.yaml`](k8s/pedidos.yaml): Define el `ConfigMap` (`pedidos-config`), el contenedor de base de datos `Deployment` + `Service` (`pedidos-mysql`), y el microservicio `Deployment` + `Service` (`pedidos-web`) con `startupProbe`, `livenessProbe` y `readinessProbe` apuntando a `/api/health`.
- [`k8s/secret.example.yaml`](k8s/secret.example.yaml): Plantilla de `Secret` (`pedidos-secret`) para variables sensibles (`DB_USER`, `DB_PASSWORD`, `RABBITMQ_URL`, `JWT_SECRET`, `CLIENTES_RPC_PASSWORD`).

### Paso a paso para desplegar en Kubernetes:

```powershell
# 1. Construir la imagen Docker local
docker build -t pedidos:lab-jwt-v1 .

# 2. Crear el namespace compartido (si no existe)
kubectl create namespace ecommerce

# 3. Crear el archivo k8s/secret.yaml a partir de k8s/secret.example.yaml con las credenciales del entorno y aplicarlo:
kubectl apply -f k8s/secret.yaml

# 4. Desplegar ConfigMap, MySQL, Deployment y Service de Pedidos
kubectl apply -f k8s/pedidos.yaml

# 5. Verificar que los Deployments, Pods y Services estén en estado Running
kubectl get deployments -n ecommerce
kubectl get pods -n ecommerce
kubectl get services -n ecommerce

# 6. Exponer el servicio en http://localhost:3000
kubectl port-forward svc/pedidos-web 3000:3000 -n ecommerce
```

### Prueba de Resiliencia y Auto-recuperación (Fase 10)
```powershell
# Eliminar el Pod de Pedidos y observar cómo el Deployment crea uno nuevo automáticamente
kubectl delete pod -l app=pedidos-web -n ecommerce
kubectl get pods -n ecommerce
```

---

## 📡 Integración con RabbitMQ (Guía para los demás grupos)

### Configuración del Exchange de Salida (`PedidoCreado`)

Para recibir los pedidos creados, tu microservicio debe conectarse a RabbitMQ usando estos parámetros:

| Parámetro | Valor |
|---|---|
| **Exchange** | `pedidos_exchange` |
| **Tipo** | `fanout` |
| **Durable** | `true` |
| **Routing Key** | `""` o `pedido.creado` *(el fanout lo distribuye a todas las colas enlazadas)* |

> ⚠️ **IMPORTANTE:** Cada microservicio debe declarar **su propia cola duradera** y enlazarla al exchange `pedidos_exchange`. Si dos servicios escuchan la misma cola, RabbitMQ repartirá los pedidos entre ellos y no los recibirán ambos.

### Colas y Exchanges que consume e integra Pedidos
| Integración | Cola / Exchange | Dirección | Descripción |
|---|---|---|---|
| **Carrito (Grupo D)** | Cola `pedidos.desde_carro` | Carrito → Pedidos (RPC) | Recibe los pedidos confirmados en el carrito, los guarda en MySQL y publica `PedidoCreado` |
| **Clientes (Grupo F)** | Colas `auth.login`, `clientes.listar`, `cliente.consultar` | Pedidos → Clientes (RPC + JWT) | Obtiene token Bearer en `auth.login` y consulta clientes reales |
| **Productos (Grupo G)** | Cola `productos.listar` | Pedidos → Productos (RPC) | Sincroniza catálogo y precios de productos |
| **Pagos (Grupo B)** | Exchange `pagos_exchange` (cola `pedidos.resultado_pagos`) | Pagos → Pedidos | Actualiza automáticamente el pedido a `PAGADO` o `CANCELADO` (`Pago rechazado`) |
| **Inventario (Grupo H)** | Exchange `inventario_exchange` (cola `pedidos.resultado_inventario`) | Inventario → Pedidos | Si recibe `InventarioInsuficiente`, actualiza el pedido a `CANCELADO` indicando los productos faltantes |

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

---

## 🚀 Puesta en Marcha Local (Sin Docker)

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

# Autenticación JWT y RPC Clientes
JWT_SECRET=tu_secreto_jwt_compartido
JWT_ALGORITHM=HS256
JWT_EXPIRES_IN=1800
CLIENTES_RPC_USER=demo
CLIENTES_RPC_PASSWORD=demo123
```

### 2. Instalar y ejecutar

```powershell
# Instalar paquetes
npm install

# Iniciar servidor (crea automáticamente la BD pedidos_db, las tablas y carga el dump inicial si está vacía)
npm start
```

Abre **`http://localhost:3000`** en tu navegador.
