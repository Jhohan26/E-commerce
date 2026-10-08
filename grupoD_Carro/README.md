# Carrito de compras (FastAPI + RabbitMQ) · Diseño Strike Store

## Ejecutar (Windows, PowerShell o CMD, dentro de esta carpeta)
    python -m venv venv
    venv\Scripts\activate
    pip install -r requirements.txt
    copy .env.example .env     (solo si aún no tienes .env; pon tu CLOUDAMQP_URL)
    uvicorn main:app --reload

En Mac/Linux: `source venv/bin/activate` y `cp .env.example .env`.

Abre http://localhost:8000, escribe el id de un cliente y compra.
No abras los .html con doble clic: son plantillas y las sirve el servidor.

## Diseño
Solo cambió la carpeta `templates/` (base, inicio, tienda, confirmacion y `_arte.html`).
`main.py`, `rabbit.py` y `productos.py` no se tocaron: mismas rutas y mismos formularios.

## Cómo funciona
- **Clientes:** RPC sobre la cola `cliente.consultar` (el worker de clientes debe estar corriendo).
- **Productos:** datos de ejemplo en `productos.py`. Para pasar a CloudAMQP, cambia `listar_productos()` por una llamada `rabbit.llamar_rpc(...)`.
- **Carrito:** en memoria (se pierde al reiniciar). No requiere base de datos.
- **Pedido:** al pulsar "Realizar pedido" se publica el evento `PedidoCreado` en el exchange `pedidos_exchange` (fanout, durable), según el contrato del README de pedidos.

## Nota sobre `pedidoId`
El contrato exige un `pedidoId`, pero aquí se genera provisionalmente con la hora actual.
Si el servicio de Pedidos debe asignarlo (y publicar él mismo el evento), cambia
`rabbit.publicar_pedido` por un `POST http://localhost:3000/api/pedidos` con
`{"clienteId": ..., "productos": [...]}`.
