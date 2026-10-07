# Reportes – Grupo C (FastAPI, sin base de datos)

Microservicio que muestra reportes de ventas, pagos y clientes. **No usa base de datos**: guarda todo en memoria y lo reconstruye desde las APIs de los otros grupos cada vez que arranca. El dashboard se actualiza solo, en el instante en que llega un dato nuevo.

## Tecnología
Python 3.10+, FastAPI + Uvicorn, RabbitMQ (pika), `requests`. Puerto `8001`.

## Ejecutar (una sola terminal)

    cd grupoC_Reportes
    .venv\Scripts\python.exe -m uvicorn main:app --reload --port 8001

Abrir **http://127.0.0.1:8001/**. Variables en `.env` (ver `.env.example`): `AMQP_URL` (broker compartido, nunca se sube a git), `PEDIDOS_URL`, `REFRESCO_SEG`.

> Ya no existe `consumer.py`: el consumidor de RabbitMQ corre dentro de la propia API. Si queda otro consumidor viejo abierto, se repartirían los mensajes: cerrarlo.

## Cómo funciona

| Fuente | Cómo | Cuándo |
|--------|------|--------|
| Clientes (F) | RabbitMQ RPC: colas `clientes.listar` y `cliente.consultar` ([cliente_rpc.py](cliente_rpc.py)); requiere su `worker.py` | Al arrancar, al pulsar Actualizar y cuando llega un pedido de un cliente desconocido |
| Productos (G) | API REST `GET /api/productos` (nombre, categoría, precio). Hay que poner su URL en `PRODUCTOS_URL`; no tiene valor por defecto | Al arrancar, al pulsar Actualizar y cuando llega un pedido con un producto desconocido |
| Pedidos (E) | API REST `GET /api/pedidos` y `/api/pedidos/{id}` | Al arrancar y al pulsar Actualizar |
| Pedidos / Pagos | Eventos RabbitMQ `PedidoCreado`, `PagoAprobado`, `PagoRechazado` en las colas propias `reportes_pedidos_queue` y `reportes_pagos_queue` | **En tiempo real** |

- **En vivo:** al cambiar cualquier dato, la API avisa a los dashboards abiertos por `/stream` (Server-Sent Events) y estos se redibujan. No hay consulta cada X segundos.
- **Respaldo:** Clientes no publica eventos y Pedidos no avisa cuando cambia el estado de un pedido; por eso cada `REFRESCO_SEG` (300 s por defecto, `0` = apagado) se vuelve a leer su API. Si Clientes publicara un evento al registrar usuarios, se podría enlazar y el respaldo sobraría.
- **Estado de pago:** viene de los eventos de Pagos; mientras no existan, se deduce del estado del pedido (PAGADO/ENVIADO/COMPLETADO → aprobado; CANCELADO → rechazado; PENDIENTE/EN_PROCESO → pendiente).
- Al reiniciar la API se pierde la memoria y se reconstruye con las APIs; los eventos publicados mientras estaba apagada esperan en la cola durable.

## API de Reportes

| Método | Ruta                     | Descripción                                                              |
|--------|--------------------------|--------------------------------------------------------------------------|
| `POST` | `/cliente`               | Mismo contrato que Clientes: body `{"id": 1}` → datos del cliente (404 si no existe) |
| `GET`  | `/clientes`              | Clientes que Reportes tiene en memoria                                   |
| `POST` | `/sincronizar`           | Vuelve a pedir todo a las APIs de Clientes y Pedidos                     |
| `POST` | `/eventos`               | Aplica `PedidoCreado`, `PagoAprobado` o `PagoRechazado` (para pruebas)   |
| `GET`  | `/reportes/resumen`      | Totales generales y 5 mejores clientes                                   |
| `GET`  | `/reportes/ventas-por-dia`, `/reportes/pagos`, `/reportes/top-productos` | Datos de las gráficas |
| `GET`  | `/reportes/cliente/{id}` | Reporte de un cliente                                                    |
| `GET`  | `/api/estado`            | Estado de las conexiones (Clientes, Pedidos, RabbitMQ)                   |
| `GET`  | `/stream`                | Canal en vivo (Server-Sent Events) que usa el dashboard                  |

### Reporte de cliente: `GET /reportes/cliente/1`

Contiene: datos del cliente (desde Clientes), total de pedidos, total comprado y pagado, ticket promedio, pagos aprobados/rechazados/pendientes, fecha del último pedido, top 5 productos y últimos 10 pedidos.

```json
{
  "cliente": {"cliente_id": 1, "nombre_completo": "Juan Carlos Pérez", "correo": "juan@example.com", "estado": 1},
  "resumen": {"total_pedidos": 3, "total_comprado": "7500000.00", "total_pagado": "5000000.00",
              "ticket_promedio": "2500000.000000", "pagos_aprobados": 2, "pagos_rechazados": 1,
              "pagos_pendientes": 0, "ultimo_pedido": "2026-10-01T10:30:00"},
  "top_productos": [{"producto_id": 15, "unidades": 4}],
  "ultimos_pedidos": [{"pedido_id": 1001, "fecha": "2026-10-01T10:30:00", "total": "5000000.00", "estado_pago": "APROBADO"}]
}
```

Si Clientes está caído, el reporte usa la última copia guardada en `ReporteCliente`. Si Clientes responde 404, devuelve 404.

### Eventos que recibe (mismo formato que Notificaciones / Semana8)

```json
{"evento":"PedidoCreado","pedidoId":1001,"clienteId":1,"fecha":"2026-10-01T10:30:00","total":5000000,
 "productos":[{"productoId":15,"cantidad":2,"precio":2500000}]}
{"evento":"PagoAprobado","pedidoId":1001,"clienteId":1,"fecha":"2026-10-01T10:31:00"}
{"evento":"PagoRechazado","pedidoId":1002,"clienteId":1,"fecha":"2026-10-01T10:32:00"}
```

Son idempotentes: reenviar el mismo evento no duplica datos. Un pago antes que su pedido responde `409`.

> Pendiente de acordar: Pagos publica en `ecommerce.eventos` y Facturación espera `pagos_exchange`. Reportes se enlaza solo al que exista (revisa cada 30 s).

## Pruebas rápidas

    curl -X POST http://localhost:8001/cliente -H "Content-Type: application/json" -d '{"id": 1}'
    curl -X POST http://localhost:8001/eventos -H "Content-Type: application/json" -d '{"evento":"PedidoCreado","pedidoId":1001,"clienteId":1,"fecha":"2026-10-01T10:30:00","total":5000000,"productos":[{"productoId":15,"cantidad":2,"precio":2500000}]}'
    curl http://localhost:8001/reportes/cliente/1
