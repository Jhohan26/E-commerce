# Para Pedidos (Grupo E) e Inventario (Grupo H): cómo darle sus datos a Reportes sin importar la red

**El problema.** Reportes (Grupo C) necesita el historial de pedidos y las existencias del inventario. Hoy eso solo está en la API web de cada uno, que corre en el computador de cada integrante. Como estamos en redes distintas, Reportes no puede llegar a `localhost:3000` ni a `localhost:8005`.

**La solución, la misma que ya usan Clientes y Productos.** Agregar un *worker* pequeño que responda por RabbitMQ (la misma instancia de CloudAMQP que ya usamos todos). No hace falta abrir puertos, compartir IPs ni crear túneles. Es un archivo nuevo en cada grupo; no se cambia nada de lo existente.

Reportes **detecta el worker solo**: en cuanto exista la cola y haya alguien atendiéndola, empieza a usarla. No hay que avisarle ni cambiar su configuración.

---

## Qué debe responder cada cola

Formato igual al de Clientes y Productos: `{"status": 200, "data": ...}` (o `{"status": 500, "error": "..."}`). La petición viene sin cuerpo; la respuesta se publica en `reply_to` copiando el `correlation_id`.

### Pedidos: cola `pedidos.listar`
`data` es una lista de pedidos **completos** (con sus productos), con los mismos campos de `GET /api/pedidos/{id}`:

```json
{
  "status": 200,
  "data": [
    {
      "id": 1001,
      "clienteId": 25,
      "fecha": "2026-10-01T10:30:00",
      "total": 5000000,
      "estado": "PAGADO",
      "productos": [ { "productoId": 15, "cantidad": 2, "precio": 2500000 } ]
    }
  ]
}
```

### Inventario: cola `inventario.listar`
`data` es la misma lista que devuelve `GET /api/inventario`:

```json
{
  "status": 200,
  "data": [
    { "producto_id": 15, "nombre": "Portátil 14\"", "cantidad": 8, "actualizado": "2026-10-13T10:00:00" }
  ]
}
```

---

## Código listo para copiar

### Pedidos (Node.js, igual que su `carroConsumer.js`)
Archivo nuevo, por ejemplo `src/consumers/reportesRpc.js`:

```js
// Responde a Reportes (Grupo C) por RabbitMQ: cola "pedidos.listar"
const amqp = require('amqplib');
const service = require('../services/pedidosService');
require('dotenv').config();

const QUEUE = 'pedidos.listar';

async function iniciarWorkerReportes() {
  const conn = await amqp.connect(process.env.RABBITMQ_URL);
  const ch = await conn.createChannel();
  await ch.assertQueue(QUEUE, { durable: true });
  await ch.prefetch(1);
  console.log(`[Worker Reportes] Escuchando "${QUEUE}"...`);

  ch.consume(QUEUE, async (msg) => {
    if (!msg) return;
    let respuesta;
    try {
      const { pedidos } = await service.listarPedidos();
      const completos = await Promise.all(pedidos.map((p) => service.obtenerPedido(p.id)));
      respuesta = { status: 200, data: completos };
    } catch (err) {
      respuesta = { status: 500, error: 'Error interno' };
    }
    if (msg.properties.replyTo) {
      ch.sendToQueue(msg.properties.replyTo, Buffer.from(JSON.stringify(respuesta)), {
        correlationId: msg.properties.correlationId,
        contentType: 'application/json',
      });
    }
    ch.ack(msg);
  });
}

module.exports = { iniciarWorkerReportes };
```

Y en `src/server.js`, junto a los otros consumidores: `await iniciarWorkerReportes();`

### Inventario (Python, igual que el `worker.py` de Productos)
Archivo nuevo, por ejemplo `worker_reportes.py`, dentro de la carpeta del proyecto:

```python
"""Responde a Reportes (Grupo C) por RabbitMQ: cola "inventario.listar"."""
import json
import os
import time

import pika
from dotenv import load_dotenv

from app.db import get_conn

load_dotenv()
COLA = "inventario.listar"


def listar():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT producto_id, nombre, cantidad, actualizado FROM Inventario ORDER BY producto_id")
            return {"status": 200, "data": cur.fetchall()}
    finally:
        conn.close()


def al_recibir(ch, method, props, body):
    try:
        respuesta = listar()
    except Exception:
        respuesta = {"status": 500, "error": "Error interno"}
    if props.reply_to:
        ch.basic_publish(
            exchange="",
            routing_key=props.reply_to,
            properties=pika.BasicProperties(correlation_id=props.correlation_id, content_type="application/json"),
            body=json.dumps(respuesta, ensure_ascii=False, default=str).encode(),
        )
    ch.basic_ack(method.delivery_tag)


def ejecutar():
    params = pika.URLParameters(os.environ["RABBITMQ_URL"])
    params.heartbeat = 30
    conn = pika.BlockingConnection(params)
    ch = conn.channel()
    ch.queue_declare(queue=COLA, durable=True)
    ch.basic_qos(prefetch_count=1)
    ch.basic_consume(queue=COLA, on_message_callback=al_recibir)
    print(f"Worker Reportes listo. Escuchando: {COLA}")
    ch.start_consuming()


if __name__ == "__main__":
    while True:
        try:
            ejecutar()
        except pika.exceptions.AMQPError as e:
            print("Conexión perdida, reintentando en 5 s:", e)
            time.sleep(5)
```

Se ejecuta aparte: `python worker_reportes.py` (o se puede lanzar en un hilo, como ya hacen con su consumidor).

---

## Cómo comprobar que quedó bien
1. Arrancar el worker. Debe aparecer el mensaje de "escuchando".
2. En el panel de CloudAMQP (**Queues**), la cola `pedidos.listar` o `inventario.listar` debe mostrar **1 consumidor**.
3. En el dashboard de Reportes, en "Conexiones con los otros servicios", el recuadro de Pedidos o de Inventario pasa a verde y dice *RabbitMQ · worker de …*.

## Qué recibe Reportes a cambio
Con el worker de Pedidos: el historial completo de pedidos (no solo los nuevos). Con el de Inventario: la gráfica de **stock por producto** con sus niveles (agotado, bajo, disponible), y se actualiza sola cada vez que Inventario publica `InventarioActualizado` o `InventarioInsuficiente`.
