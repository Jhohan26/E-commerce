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

Esta adaptación conecta J con las salidas actuales. Los equipos todavía deben corregir Pedidos → Pagos y Pagos → Facturación. Clientes no publica un evento de registro; ese evento no está implementado.

## Correo

Activar EMAIL_ENABLED=true en .env.integracion y configurar SMTP_USER, SMTP_PASSWORD (contraseña de aplicación), SMTP_FROM, SMTP_HOST, SMTP_PORT y SMTP_SECURE. Gmail utiliza smtp.gmail.com, puerto 587, SMTP_SECURE=false con STARTTLS obligatorio. Nunca guardar contraseñas en Git.

Cada nuevo evento guarda una notificación y un trabajo de correo en una transacción antes del ACK. Un worker consulta cliente.consultar por RabbitMQ, verifica que la respuesta corresponda al cliente activo y obtiene su correo. El worker de Clientes debe estar encendido. No se envían correos retroactivos al activar la función.

Los trabajos pendientes sobreviven al reinicio y tienen cinco intentos con espera creciente. Consultar EmailJob en SQLite para ver pending, accepted o failed. accepted significa que SMTP aceptó el mensaje; no confirma recepción en la bandeja. Un fallo entre el envío y su registro puede ocasionar duplicados: SMTP no garantiza exactamente una entrega. Ejecutar una única instancia del worker por esta base SQLite.

## API y pruebas

GET /api/notificaciones, GET /api/notificaciones/cliente/:clienteId, GET /api/notificaciones/:id y PATCH /api/notificaciones/:id/leida.

El panel no tiene autenticación por usuario; mantenerlo en localhost hasta agregar autorización. Nunca subir .env ni credenciales. Rotar contraseñas distribuidas y limitar permisos por servicio.

`npm run test:integration` crea recursos temporales en el broker configurado: ejecutar solo en pruebas. El script publish sirve para la topología local; no ejecutar eventos de prueba en el broker común porque pueden desencadenar operaciones en otros servicios.
