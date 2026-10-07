# Microservicio de Notificaciones — Grupo J

Recibe eventos por RabbitMQ, guarda notificaciones en SQLite y permite consultarlas en la bandeja web y API. Requiere Node.js 24 o superior.

## Ejecución local

Copiar .env.example a .env y ejecutar `docker compose up -d --build`. Abrir http://localhost:3000 o el HOST_PORT configurado. Fuera de Docker: `npm ci` y `npm start`, con RabbitMQ disponible. Pruebas: `npm test`.

## Integración

Copiar .env.integracion.example a .env.integracion y poner la URL AMQPS vigente del equipo. Ejecutar:

```powershell
docker compose --env-file .env.integracion -f docker-compose.integracion.yml up -d --build
```

Abrir http://localhost:3010. /health/ready devuelve 200 cuando el consumidor está conectado.

RABBITMQ_SOURCES define los exchanges del ZIP: pedidos_exchange (fanout), ecommerce.eventos (topic, claves pago.aprobado y pago.rechazado), inventario_exchange (fanout) y facturacion_exchange (fanout). Confirmar nombres y tipos con los equipos: un exchange existente no puede redeclararse con otro tipo. J usa una cola propia durable, nunca las colas de Pagos, Inventario o Facturación. Cada fuente puede restringir nombres de evento mediante events. Las claves topic/direct configuradas deben ser exactas, sin comodines.

Se reciben PedidoCreado, PagoAprobado, PagoRechazado, FacturaGenerada e InventarioInsuficiente. Requieren clienteId y pedidoId positivos y fecha ISO; PedidoCreado también necesita total y productos. InventarioActualizado se confirma sin generar aviso cuando llega desde inventario_exchange. Otros eventos incompatibles se rechazan a la DLQ grupo-j.notificaciones.errores.

AMQPS valida certificados; heartbeat predeterminado 30 segundos y tamaño máximo 256 KiB. El almacenamiento precede al ACK y los duplicados se detectan por contenido. SQLite persiste en un volumen; database/mysql contiene solamente el esquema de referencia.

Esta adaptación conecta J con las salidas actuales. Los equipos todavía deben corregir Pedidos → Pagos y Pagos → Facturación. Clientes no publica un evento de registro y este servicio no envía correos: faltan ese contrato y un proveedor de correo.

## API y pruebas

GET /api/notificaciones, GET /api/notificaciones/cliente/:clienteId, GET /api/notificaciones/:id y PATCH /api/notificaciones/:id/leida.

El panel no tiene autenticación por usuario; mantenerlo en localhost hasta agregar autorización. Nunca subir .env ni credenciales. Rotar contraseñas distribuidas y limitar permisos por servicio.

`npm run test:integration` crea recursos temporales en el broker configurado: ejecutar solo en pruebas. El script publish sirve para la topología local; no ejecutar eventos de prueba en el broker común porque pueden desencadenar operaciones en otros servicios.
