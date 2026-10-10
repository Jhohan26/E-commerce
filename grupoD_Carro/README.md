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
- **Pedido:** al pulsar "Realizar pedido" el carrito hace una petición RPC sobre CloudAMQP a la cola `pedidos.desde_carro` con `{"clienteId", "clienteNombre", "productos":[{"productoId","cantidad","precio"}]}` (`clienteNombre` es informativo: Pedidos hoy lo ignora y no forma parte del evento oficial). El microservicio de Pedidos guarda el pedido, le asigna el id real, responde (status 201) y publica él mismo el evento `PedidoCreado` en `pedidos_exchange` (el carrito ya no lo publica). Si Pedidos está apagado o rechaza el pedido, se muestra el error y el carrito se conserva.

## Requisito para crear pedidos
El microservicio de Pedidos debe estar corriendo y conectado a **la misma instancia de CloudAMQP** que este carrito (su `RABBITMQ_URL` = tu `CLOUDAMQP_URL`). En su consola debe aparecer `[Consumidor Carro] Escuchando solicitudes en la cola "pedidos.desde_carro"`. No se usa HTTP ni `localhost:3000`.

## Simular clientes (si el Grupo de Clientes no está disponible)
La simulación está **activada por defecto**: no hay que configurar nada. Cualquier id abre la tienda con un cliente de prueba marcado como `[SIMULADO]` (el `99` está deshabilitado; `1`, `2` y `25` tienen nombre propio).
Cuando Clientes esté disponible, pon `SIMULAR_CLIENTES=false` en el `.env` y reinicia el carrito para usar el worker real por RabbitMQ.
