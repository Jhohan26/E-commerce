# Microservicio de Notificaciones — Grupo J

Recibe eventos por RabbitMQ, guarda notificaciones en SQLite y permite consultarlas en la bandeja web y API. Requiere Node.js 24 o superior.

## Ejecución local

Copiar .env.example a .env y configurar JWT_SECRET con una clave aleatoria privada de al menos 32 bytes. Ejecutar `docker compose up -d --build`. Abrir http://localhost:3000 o el HOST_PORT configurado. Fuera de Docker: `npm ci`, `node --env-file=.env scripts/manage-access.js bootstrap` y `npm start`, con RabbitMQ disponible. Pruebas: `npm test`.

## Integración

Copiar .env.integracion.example a .env.integracion y poner la URL AMQPS vigente del equipo. Ejecutar:

```powershell
docker compose --env-file .env.integracion -f docker-compose.integracion.yml up -d --build
```

Abrir http://localhost:3010. /health/ready devuelve 200 cuando el consumidor está conectado.

RABBITMQ_SOURCES define los exchanges del ZIP revisado el 19 de octubre de 2026: pedidos_exchange (fanout), pagos_exchange (topic, claves pago.aprobado y pago.rechazado), inventario_exchange (fanout) y facturacion_exchange (fanout). Confirmar nombres y tipos con los equipos: un exchange existente no puede redeclararse con otro tipo. J usa una cola propia durable, nunca las colas de Pagos, Inventario o Facturación. Cada fuente puede restringir nombres de evento mediante events. Las claves topic/direct configuradas deben ser exactas, sin comodines.

Se reciben PedidoCreado, PagoAprobado, PagoRechazado, FacturaGenerada e InventarioInsuficiente. Requieren clienteId y pedidoId positivos y fecha ISO; PedidoCreado también necesita total y productos. InventarioActualizado no genera aviso y no está incluido en los permisos de la cuenta inventario. Otros eventos incompatibles o no autorizados se rechazan a la DLQ grupo-j.notificaciones.errores.

AMQPS valida certificados; heartbeat predeterminado 30 segundos y tamaño máximo 256 KiB. El almacenamiento precede al ACK y los duplicados se detectan por contenido. SQLite persiste en un volumen; database/mysql contiene solamente el esquema de referencia.

Pagos ya separa el exchange de entrada pedidos_exchange del de salida pagos_exchange. En el ZIP, Facturación todavía enlaza su cola con una routing key vacía: el grupo K debe cambiarla a pago.aprobado para recibir desde el topic de Pagos. Esto no impide que J escuche directamente a Pagos. Clientes no publica un evento de registro y no se agregó una notificación de registro inventada. Carro solicita pedidos mediante pedidos.desde_carro y Pedidos publica después PedidoCreado; J escucha el evento final, sin consumir la cola de Carro. Reportes y Productos no requieren cuentas de publicación en J para estos cinco eventos.

## Correo

Activar EMAIL_ENABLED=true en .env.integracion y configurar SMTP_USER, SMTP_PASSWORD (contraseña de aplicación), SMTP_FROM, SMTP_HOST, SMTP_PORT y SMTP_SECURE. Gmail utiliza smtp.gmail.com, puerto 587, SMTP_SECURE=false con STARTTLS obligatorio. Nunca guardar contraseñas en Git.

Cada nuevo evento guarda una notificación y un trabajo de correo en una transacción antes del ACK. El worker inicia sesión en Clientes y consulta cliente.consultar, verifica que la respuesta corresponda al cliente activo y obtiene su correo. El worker de Clientes debe estar encendido. No se envían correos retroactivos al activar la función.

## Acceso al servicio de Clientes actualizado

Configurar CLIENTES_RPC_USERNAME y CLIENTES_RPC_PASSWORD con la cuenta que asigne el grupo F a Notificaciones. Las credenciales temporales comunicadas por el grupo se guardan solo en el entorno privado, no en este repositorio. CLIENTES_RABBITMQ_URL permite usar otro broker para Clientes; si está vacío, se utiliza RABBITMQ_URL. No cambiar el broker de todos los eventos para solucionar únicamente una consulta de Clientes.

Se envía a auth.login el JSON `{"usuario":"<cuenta asignada>","password":"<contraseña>"}`. La respuesta esperada es `{"status":200,"data":{"token":"<JWT de Clientes>","expira_en_segundos":1800}}`. Después se consulta cliente.consultar con `{"id":1}` y la propiedad AMQP `headers.Authorization="Bearer <JWT de Clientes>"`. La respuesta debe contener status=200 y data con id, estado=1 y correo válido.

El token se conserva en memoria y se reutiliza hasta poco antes de su vencimiento. Ante un 401 se inicia sesión y se repite la consulta una sola vez. Las consultas concurrentes comparten el login en curso. No se degrada a consultas anónimas si falta una contraseña. CLIENTES_RPC_LOGIN_QUEUE y CLIENTES_RPC_QUEUE permiten cambiar los nombres de las colas; CLIENTES_RPC_TIMEOUT_MS limita la espera de cada solicitud. Una cola sin ruta, un login rechazado, un cliente inexistente y un correo inválido se muestran con motivos distintos en la bandeja.

El JWT emitido por Clientes permite a J consultar Clientes. Es independiente del JWT emitido por Notificaciones para autorizar a Pedidos/Pagos/Inventario/Facturación; no se comparten las claves de firma ni se intercambian esos tokens.

Los trabajos pendientes sobreviven al reinicio y tienen cinco intentos con espera creciente. Consultar EmailJob en SQLite para ver pending, accepted o failed. accepted significa que SMTP aceptó el mensaje; no confirma recepción en la bandeja. Un fallo entre el envío y su registro puede ocasionar duplicados: SMTP no garantiza exactamente una entrega. Ejecutar una única instancia del worker por esta base SQLite.

## API y pruebas

GET /api/notificaciones, GET /api/notificaciones/cliente/:clienteId, GET /api/notificaciones/:id y PATCH /api/notificaciones/:id/leida.

El panel requiere una cuenta de administrador. Los módulos solo pueden enviar los eventos autorizados y no pueden listar ni marcar las notificaciones. Nunca subir .env ni credenciales. Rotar contraseñas distribuidas y limitar permisos por servicio.

## Acceso JWT

Configurar JWT_SECRET con al menos 32 bytes aleatorios en el entorno privado. Ejecutar `node --env-file=.env.integracion scripts/manage-access.js bootstrap` para crear administrador y cuentas de Pedidos, Pagos, Inventario y Facturación. Las contraseñas aleatorias se guardan en `.artifacts/credenciales-modulos.json`, excluido de Git. Entregar a cada equipo únicamente su entrada. No hay registro público de cuentas. `rotate <cuenta>` cambia su contraseña y revoca sus sesiones; `disable <cuenta>` la deshabilita.

Cada equipo inicia sesión mediante POST `/api/auth/login`, Content-Type application/json, con `username` y `password`. La respuesta contiene `access_token`, `expiresAt` e `inactivitySeconds`. Guardar el token como secreto y reutilizarlo; no hace falta iniciar sesión para cada evento. JWT tiene identificador aleatorio por sesión. El servidor valida firma HS256, emisor, audiencia, cuenta habilitada y sesión no revocada.

El token vence tras AUTH_IDLE_SECONDS sin solicitudes válidas (1800 segundos por defecto) y tiene una duración máxima AUTH_LIFETIME_SECONDS (28800 segundos). Una actividad válida renueva el plazo de inactividad, no la fecha máxima. Al vencer debe iniciarse sesión otra vez. El endpoint de consulta de sesión del panel no prolonga la actividad. Cerrar sesión revoca el token inmediatamente. Hay límite persistente de intentos de login por cuenta e IP.

Para enviar por HTTP: POST `/api/eventos`, con `Authorization: Bearer <token>` y el JSON del evento. Para RabbitMQ se utiliza el mismo JWT en las propiedades del mensaje: `headers: { authorization: 'Bearer <token>' }`. En Python/pika corresponde a BasicProperties(headers={"authorization": "Bearer " + token}). El cuerpo JSON de negocio no cambia. El publicador local necesita MODULE_TOKEN.

Permisos: pedidos → PedidoCreado; pagos → PagoAprobado/PagoRechazado; inventario → InventarioInsuficiente; facturacion → FacturaGenerada. Los módulos no pueden otorgarse permisos desde el login. La cuenta administrador accede al panel mediante cookie HttpOnly y SameSite=Strict; los tokens de módulos se envían como Bearer, no se almacenan en el navegador.

En el consumidor activo los mensajes sin JWT válido o con un evento no autorizado se rechazan a la cola de errores. Los grupos deben adaptar sus publicadores antes de esperar aceptación. Los mensajes caducados en cola requieren revisión y reenvío autorizado; no se ejecuta automáticamente un mensaje antiguo con una identidad nueva.

JWT aquí protege la API y el procesamiento de eventos; no modifica las cuentas del broker ni impide conexiones AMQP por sí mismo. El administrador de CloudAMQP debe crear usuarios por módulo, limitar escritura a sus exchanges y reservar lectura de grupo-j.notificaciones al servicio J. La contraseña RabbitMQ compartida no proporciona ese aislamiento.

Los publicadores de Pedidos, Pagos, Inventario y Facturación del ZIP recibido todavía no añaden el JWT de Notificaciones a sus eventos. Cada grupo debe integrar nuestro login y adjuntar el token, o enviar por POST /api/eventos autenticado. La presencia de un JWT propio en su API no otorga acceso automático a J. No se quitó la autenticación para aceptar esos mensajes.

Fuera de localhost se requiere HTTPS para el login y la API, AMQPS para RabbitMQ y AUTH_SECURE_COOKIE=true. No entregar JWT_SECRET a los demás módulos. Con Docker, crear las cuentas contra la base del volumen mediante `docker compose --env-file .env.integracion -f docker-compose.integracion.yml exec notificaciones node scripts/manage-access.js bootstrap`; las credenciales estarán dentro del contenedor en /app/.artifacts/credenciales-modulos.json y deben recuperarse de forma privada.

`npm run test:integration` crea recursos temporales en el broker configurado: ejecutar solo en pruebas. El script publish sirve para la topología local; no ejecutar eventos de prueba en el broker común porque pueden desencadenar operaciones en otros servicios.


LOGIN DE MÓDULOS MEDIANTE CLOUDAMQP (20 de octubre de 2026)
Notificaciones atiende AUTH_RPC_QUEUE=notificaciones.auth.login en RABBITMQ_URL.
Esta cola es distinta de auth.login, que pertenece a Clientes.
No hace falta una URL HTTP pública para obtener el JWT por esta vía.
Notificaciones y el módulo solicitante deben estar encendidos y tener acceso
al mismo broker/vhost. CloudAMQP transporta la solicitud; J emite el token.

Solicitud JSON: {"username":"pedidos","password":"<credencial individual>"}.
Enviar al exchange por defecto con routing key notificaciones.auth.login,
replyTo con una cola temporal exclusiva generada por RabbitMQ (amq.gen-...),
correlationId aleatorio, persistent=false y expiration=15000.
Respuesta JSON: {"status":200,"data":{"access_token":"<JWT>",
"token_type":"Bearer","expiresAt":"<ISO>","inactivitySeconds":1800,"role":"module"}}.
Errores: status 400/401/403/413/429/500 y campo error; no incluyen secretos.
El administrador continúa usando el panel HTTP; no se admite su login RPC.
La cola no es durable, tiene TTL de 15 segundos, máximo 100 solicitudes y
consumo secuencial. No se vincula a la cola de errores de eventos.
Se mantiene el límite compartido de 10 logins por 15 minutos por transporte
RabbitMQ, además del límite por cuenta. Reutilizar los tokens para no agotarlo.
No enviar credenciales continuamente ni publicarlas en exchanges de eventos.

Publicar los eventos habituales con headers.Authorization="Bearer <JWT de J>".
Conservar el token en memoria; al expirar por inactividad o duración absoluta,
volver a solicitarlo con las mismas credenciales. No hay que pedirlo a J manualmente.
RabbitMQ no devuelve al productor el 401 del consumidor de eventos: coordinar
renovación antes de la expiración y la inactividad, y revisar los rechazos.
Ejemplo: examples/notificaciones-rpc.js exporta un cliente con login cacheado.
La cola y JWT no sustituyen los usuarios y permisos del broker: reservar a J
la lectura de notificaciones.auth.login y de su cola de eventos; los otros
módulos necesitan publicar login y consumir exclusivamente su cola de respuesta.
AMQPS cifra el transporte; quien administre el broker puede ver los mensajes.
