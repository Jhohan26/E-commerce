# Notificaciones — Grupo J
Versión 2.0.0 del laboratorio JWT y Kubernetes. Node.js 24, Express, RabbitMQ,
SQLite, nodemailer y JWT HS256. Recibe eventos, conserva notificaciones y trabajos
de correo, y protege las APIs administrativas y la bandeja.

## Autenticación del laboratorio
USER_AUTH_MODE=clientes delega POST /api/auth/login a auth.login del Grupo F.
J verifica firma HS256, sub, iat, exp, iss y role/rol firmado; admite los roles
cliente, operador y administrador. Solo administrador puede consultar o marcar
notificaciones. El profesor permite que una API no acepte los tres roles.
No se concede acceso por un rol o user_id enviado en el cuerpo de la petición.

CLIENTES_JWT_SECRET y CLIENTES_JWT_ISSUER se acuerdan en privado con F.
CLIENTES_JWT_AUDIENCE es opcional; si se configura, debe coincidir.
No se copia la clave predeterminada de otro repositorio. No hay fallback local.

**Dependencia pendiente:** en E-commerce-main (3).zip, F todavía emite tokens
sin rol ni emisor. Se rechazan de forma segura. La validación de J está probada
con un emisor controlado; no certifica el servicio real de F.
Ver [acuerdo con Clientes](docs/INTEGRACION-CLIENTES.md).

USER_AUTH_MODE=local conserva las cuentas existentes para demostrar J de manera
independiente mientras F completa su contrato. No se presenta como login central.
El panel utiliza cookie HttpOnly/SameSite Strict; no guarda JWT en localStorage.
J aplica inactividad de 30 minutos y máximo 8 horas sin extender exp de F.
El logout de J no revoca el token en otros microservicios.

## APIs y permisos
- GET / y archivos web: públicos, formulario sin datos privados.
- GET /health/live: público, proceso HTTP.
- GET /health/ready: público; 200 conectado a RabbitMQ, 503 desconectado.
- POST /api/auth/login: público, credenciales y limitación de intentos.
- GET /api/auth/session: administrador autenticado.
- POST /api/auth/logout: autenticado, revocación local.
- GET /api/notificaciones, /cliente/:clienteId, /:id: administrador.
- PATCH /api/notificaciones/:id/leida: administrador, modifica estado de lectura.
- POST /api/auth/module-login: login opcional de cuentas técnicas locales.
- POST /api/eventos: token técnico local y permiso explícito sobre el evento.

401: token ausente, alterado, vencido o claims inválidos; 403: rol sin permiso;
400: contrato/JSON inválido; 429: límite de login; 503: autenticación no disponible.
No hay registro público. No existen rutas privadas sin autorización.

## RabbitMQ y correo
La autenticación HTTP del usuario es distinta de las credenciales AMQPS del servicio.
RABBITMQ_REQUIRE_EVENT_JWT=false por defecto mantiene el consumo existente.
El broker debe restringir publicación y consumo por usuario técnico: un exchange
por sí solo no autentica al productor. J valida origen, clave y contrato, confirma
ACK después de guardar y deduplica reentregas. Nunca consume colas ajenas.
Fuentes: pedidos_exchange fanout, pagos_exchange topic (pago.aprobado/rechazado),
inventario_exchange fanout y facturacion_exchange fanout.
La cola propia es grupo-j.notificaciones, con su DLQ.

`RABBITMQ_AUTH_RPC_ENABLED=true` habilita `notificaciones.auth.login` para que
cada microservicio obtenga su JWT con credenciales individuales emitidas por J.
En Docker de integración y Kubernetes está habilitado sin exigir cambios en los
eventos. `RABBITMQ_REQUIRE_EVENT_JWT=true` es independiente y exige el JWT en
cada evento; actívalo solo tras coordinarlo con todos los productores. Las
credenciales AMQPS del broker son distintas. Comparte solo la cuenta de cada
equipo por un canal privado; nunca subas el JSON de credenciales a GitHub.
Ver [login RPC por módulo](examples/LOGIN-RABBITMQ.md).

EMAIL_ENABLED=true activa SMTP y consulta de destinatarios mediante F.
CLIENTES_RPC_USERNAME/PASSWORD son credenciales técnicas asignadas por F a J.
Los fallos no borran la notificación. accepted significa aceptación SMTP, no
entrega confirmada en la bandeja del destinatario.

## Ejecución
Copiar .env.integracion.example a .env.integracion y completar los secretos.
La plantilla usa modo local de demostración hasta disponer del contrato de F.

```powershell
npm ci
npm test
docker build -t grupo-j-notificaciones:2.0.0 .
docker compose --env-file .env.integracion -f docker-compose.integracion.yml up -d --build
```

Bandeja: http://localhost:3010. Compose conserva ./data; SQLite es el motor activo.
Las credenciales locales permanecen en .artifacts y no se suben a Git.
Ver [Kubernetes](docs/KUBERNETES.md), [Postman](postman/README.md),
[requisitos y evidencias](docs/LABORATORIO.md) y configuraciones.txt.
No se requiere contratar AWS para el laboratorio.
