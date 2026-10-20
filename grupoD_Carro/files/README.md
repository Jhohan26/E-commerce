# Carrito de compras (FastAPI + RabbitMQ)

## Ejecutar
    pip install -r requirements.txt
    cp .env.example .env     # y pon tu CLOUDAMQP_URL
    uvicorn main:app --reload

Abre http://localhost:8000, escribe el id de un cliente y compra.

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
