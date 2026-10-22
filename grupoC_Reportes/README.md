# Reportes – Grupo C (FastAPI, sin base de datos)

Microservicio que muestra reportes de ventas, pagos y clientes. **No usa base de datos**: guarda todo en memoria y lo reconstruye desde las APIs de los otros grupos cada vez que arranca. El dashboard se actualiza solo, en el instante en que llega un dato nuevo.

## Tecnología
Python 3.10+, FastAPI + Uvicorn, RabbitMQ (pika), `requests`. Puerto `8001`.

## Ejecutar (una sola terminal)

    cd grupoC_Reportes
    .venv\Scripts\python.exe iniciar.py

Abrir **http://127.0.0.1:8001/**. Variables en `.env` (ver `.env.example`): `AMQP_URL` (broker compartido, nunca se sube a git), `PEDIDOS_URL`, `PRODUCTOS_URL`, `INVENTARIO_URL`, `REFRESCO_SEG`.

- `iniciar.py` arranca uvicorn con recarga automática y un límite de 2 s para cerrar las conexiones en vivo. Si prefieres el comando directo: `uvicorn main:app --reload --port 8001 --timeout-graceful-shutdown 2`.
- Ya no existe `consumer.py`: el consumidor de RabbitMQ corre dentro de la propia API. Si queda otro consumidor viejo abierto, se repartirían los mensajes: cerrarlo.
- **Respaldo:** los pedidos y pagos recibidos por RabbitMQ se copian en `datos/respaldo.json` (no es una base de datos; no se sube a git) para no perderlos si la API se reinicia, ya que RabbitMQ los entrega una sola vez. Se apaga con `RESPALDO=0`.

## Ejecutar con Docker

Requiere Docker Desktop encendido y el `.env` configurado (el `.env` no se copia a la imagen: se pasa al ejecutar).

    cd grupoC_Reportes
    docker compose up -d --build     # construye la imagen y arranca el contenedor "reportes"
    docker compose logs -f           # ver los logs (Ctrl+C para salir)
    docker compose down              # detenerlo

Abrir **http://127.0.0.1:8001/**. Notas:
- Dentro del contenedor `localhost` es el propio contenedor. Por eso `docker-compose.yml` cambia `PEDIDOS_URL` a `http://host.docker.internal:3000` (tu computador). Si Pedidos o Inventario corren en otro equipo, pon su IP.
- `datos/` se monta como volumen: el respaldo de pedidos y pagos se conserva aunque se borre el contenedor.
- No ejecutar a la vez `iniciar.py` y el contenedor: los dos usarían el puerto 8001 y se repartirían los mensajes de RabbitMQ.
- Sin compose: `docker build -t reportes .` y `docker run --rm -p 8001:8001 --env-file .env -v ${PWD}/datos:/app/datos reportes`.

## Cómo funciona

| Fuente | Cómo | Cuándo |
|--------|------|--------|
| Clientes (F) | RabbitMQ RPC: colas `clientes.listar` y `cliente.consultar` ([cliente_rpc.py](cliente_rpc.py)); requiere su `worker.py` | Al arrancar, al pulsar Actualizar y cuando llega un pedido de un cliente desconocido |
| Productos (G) | RabbitMQ RPC: colas `productos.listar` y `producto.consultar` (su `worker.py`); mismo `AMQP_URL`. Respaldo HTTP con `PRODUCTOS_MODO=http` + `PRODUCTOS_URL` | Al arrancar, al pulsar Actualizar y cuando llega un pedido con un producto desconocido |
| Pedidos (E) | API REST `GET /api/pedidos` y `/api/pedidos/{id}` | Al arrancar y al pulsar Actualizar |
| Pedidos / Inventario por RabbitMQ (opcional) | Si crean un worker con las colas `pedidos.listar` / `inventario.listar`, Reportes lo detecta solo y deja de necesitar sus IPs. Qué deben agregar: [PEDIR_A_PEDIDOS_E_INVENTARIO.md](PEDIR_A_PEDIDOS_E_INVENTARIO.md) | Al arrancar, al pulsar Actualizar y con cada evento de inventario |
| Facturación (K) | Evento `FacturaGenerada` por RabbitMQ: cola propia `reportes_facturacion_queue` enlazada a `facturacion_exchange`; un `facturaId` repetido se ignora | **En tiempo real** |
| Pedidos / Pagos | Eventos RabbitMQ `PedidoCreado`, `PagoAprobado`, `PagoRechazado` en las colas propias `reportes_pedidos_queue` y `reportes_pagos_queue` | **En tiempo real** |

### Autenticación JWT con los otros grupos

Clientes, Inventario, Pedidos y Productos ya no entregan datos sin token. Reportes inicia sesión solo, guarda el token en memoria y, si recibe `401` (vencido), vuelve a iniciar sesión y reintenta una vez. Las cuentas van en el `.env` (ver `.env.example`):

| Grupo | Cómo obtiene el token | Variables | Cómo lo envía |
|-------|----------------------|-----------|---------------|
| Clientes (F) | Cola `auth.login` con `{"usuario","password"}` | `CLIENTES_RPC_USUARIO`, `CLIENTES_RPC_PASSWORD` | Header AMQP `Authorization: Bearer <token>` |
| Inventario (H) | Cola `inventario.login` (su propia clave, distinta a la de F) | `INVENTARIO_RPC_USUARIO`, `INVENTARIO_RPC_PASSWORD` | Header AMQP `Authorization: Bearer <token>` |
| Pedidos (E) | `POST /api/auth/token` con `{"role": "operador"}` (o un token fijo en `PEDIDOS_TOKEN`) | `PEDIDOS_ROL`, `PEDIDOS_TOKEN` | Header HTTP `Authorization: Bearer <token>` |
| Productos (G) | Cola `productos.login` con `{"usuario","password"}` | `PRODUCTOS_RPC_USUARIO`, `PRODUCTOS_RPC_PASSWORD` | Header AMQP `Authorization: Bearer <token>` |

Si falta una cuenta o la rechazan, el recuadro de ese servicio en el dashboard lo explica (por ejemplo: *Faltan CLIENTES_RPC_USUARIO y CLIENTES_RPC_PASSWORD en el .env*).

- **En vivo:** al cambiar cualquier dato, la API avisa a los dashboards abiertos por `/stream` (Server-Sent Events) y estos se redibujan. No hay consulta cada X segundos.
- **Respaldo:** Clientes no publica eventos y Pedidos no avisa cuando cambia el estado de un pedido; por eso cada `REFRESCO_SEG` (300 s por defecto, `0` = apagado) se vuelve a leer su API. Si Clientes publicara un evento al registrar usuarios, se podría enlazar y el respaldo sobraría.
- **Estado de pago:** viene de los eventos de Pagos (`PagoAprobado` / `PagoRechazado`), que mandan siempre. Mientras no haya evento, se deduce del estado del pedido en Pedidos: PAGADO / ENVIADO / COMPLETADO → aprobado; PENDIENTE / EN_PROCESO → pendiente; **CANCELADO → cancelado** (Pedidos cancela tanto por pago rechazado como por inventario insuficiente, así que sin el evento de Pagos no se puede saber cuál fue).
- **Falta de stock:** el evento `InventarioInsuficiente` marca el pedido como "SIN STOCK". Esos pedidos no cuentan como venta aprobada aunque el pago se haya aprobado.
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
