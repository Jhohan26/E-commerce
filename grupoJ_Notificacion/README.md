# Manual del microservicio de Notificaciones — Grupo J

Este manual explica cómo iniciar Notificaciones, entrar al panel y conectar los
otros microservicios. Los ejemplos usan nombres de variables y contraseñas
ilustrativas. Las credenciales reales se entregan a cada grupo por separado.

## 1. Qué hace Notificaciones

Recibe avisos sobre pedidos, pagos, inventario y facturación. Con esos avisos
crea notificaciones, las guarda en SQLite y las muestra en el panel.
Si el correo está habilitado, consulta el destinatario en Clientes y programa
el envío por SMTP.

Por ejemplo: Pagos confirma un pago, envía PagoAprobado y Notificaciones muestra
“Pago aprobado” para ese pedido. El envío de correo es un proceso separado:
la notificación puede existir aunque Clientes o SMTP no respondan.

## 2. Quién utiliza cada acceso

**Administrador de Notificaciones:** entra al panel web para consultar las
notificaciones, revisar el estado de los correos y marcar mensajes como leídos.

**Otros microservicios:** utilizan sus cuentas técnicas para enviar eventos.
No entran al panel. Su programa obtiene un token y lo adjunta al envío.

**Notificaciones cuando consulta a Clientes:** utiliza la cuenta técnica que
el Grupo F le asigna. Esa cuenta se configura en CLIENTES_RPC_USERNAME y
CLIENTES_RPC_PASSWORD. No es una cuenta de acceso al panel de Notificaciones.

**Conexión al broker:** utiliza la URL AMQPS de RabbitMQ. Sus credenciales son
distintas del usuario y contraseña de una cuenta técnica de la aplicación.

En este manual, un worker es el proceso que está ejecutándose para atender
mensajes. Debe permanecer encendido para responder solicitudes.

## 3. Conceptos necesarios

- **API HTTP:** una dirección a la que un programa envía solicitudes GET, POST o PATCH.
- **RabbitMQ / CloudAMQP:** el intermediario que transporta los mensajes.
  CloudAMQP no es el formulario web de acceso a Notificaciones.
- **Cola:** destino al que se envía una solicitud para que el worker la procese.
- **JWT o token:** credencial temporal emitida después de validar usuario y contraseña.
- **RPC:** envío de una solicitud por RabbitMQ y espera de una respuesta.
- **.env:** archivo privado que guarda la configuración de un programa.

El token no se inventa ni se escribe manualmente en el código. El cliente
entregado lo obtiene y lo reutiliza automáticamente.

## 4. Requisitos para ejecutar Notificaciones

Se necesita Docker Desktop encendido y acceso al broker AMQPS del equipo.
Para ejecutar los scripts y pruebas fuera del contenedor se necesita Node.js
24 o superior y las dependencias instaladas con npm ci.

Abrir una terminal dentro de grupoJ_Notificacion. Si ya se está trabajando en
la carpeta local del microservicio, ejecutar los comandos desde esa carpeta.

No ejecutar los comandos dentro del ZIP o de una carpeta temporal del visor:
extraer el proyecto y trabajar en una carpeta permanente.

## 5. Configurar el servicio de Notificaciones

### Paso 1. Preparar el archivo privado

Solo si todavía no existe .env.integracion, copiar la plantilla:

```powershell
if (-not (Test-Path .env.integracion)) {
    Copy-Item .env.integracion.example .env.integracion
}
```

Si ya existe, editarlo conservando las credenciales que funcionan.
No reemplazarlo por la plantilla, porque se perderían los valores privados.

### Paso 2. Completar los valores principales

```dotenv
RABBITMQ_URL=amqps://USUARIO_BROKER:CONTRASENA_BROKER@HOST/VHOST
JWT_SECRET=CLAVE_PRIVADA_ALEATORIA_DE_AL_MENOS_32_BYTES
USER_AUTH_MODE=local
RABBITMQ_AUTH_RPC_ENABLED=true
AUTH_RPC_QUEUE=notificaciones.auth.login
EVENT_RPC_QUEUE=notificaciones.eventos
AUTH_MODULE_LIFETIME_SECONDS=1800
RABBITMQ_REQUIRE_EVENT_JWT=false
HOST_PORT=3010
```

Los textos en mayúsculas del ejemplo son marcadores: deben reemplazarse.
JWT_SECRET pertenece a J y se conserva en privado; los demás módulos no
necesitan esa clave para solicitar sus tokens.

RABBITMQ_SOURCES ya viene definido en la plantilla. Describe los exchanges
compartidos del equipo. No cambiar sus nombres o tipos sin coordinarlos.

RABBITMQ_AUTH_RPC_ENABLED habilita el login técnico y la recepción RPC.
La cola notificaciones.eventos siempre valida el JWT y los permisos del módulo.

RABBITMQ_REQUIRE_EVENT_JWT controla otra vía: los eventos publicados en los
exchanges compartidos. Se mantiene false durante la migración para no bloquear
a grupos que todavía publican sin el JWT de J. Activarlo solo cuando todos los
productores correspondientes estén preparados. No desactiva la seguridad de
la API HTTP ni de la cola RPC autenticada.

### Paso 3. Preparar las cuentas locales en una instalación nueva

```powershell
npm ci
node --env-file=.env.integracion scripts/manage-access.js bootstrap
```

El script crea las cuentas que falten y guarda sus credenciales privadas en
.artifacts/credenciales-modulos.json. No sobreescribe las cuentas existentes.
Para esta ejecución en Windows, DATABASE_PATH debe apuntar a la base local
que monta Compose, normalmente ./data/notificaciones.sqlite.

Si las cuentas y la base ya existen, se utilizan las mismas credenciales.
No es necesario crear usuarios de nuevo cada vez que Docker arranca.

### Paso 4. Encender el servicio

```powershell
docker compose --env-file .env.integracion -f docker-compose.integracion.yml up -d --build
```

Consultar su estado:

```powershell
docker compose --env-file .env.integracion -f docker-compose.integracion.yml ps
```

El contenedor debe aparecer en ejecución y saludable.
Para leer los registros:

```powershell
docker compose --env-file .env.integracion -f docker-compose.integracion.yml logs --tail 80 notificaciones
```

### Paso 5. Comprobar HTTP y RabbitMQ

Abrir en el navegador:

- http://localhost:3010/health/live: confirma que el proceso HTTP responde.
- http://localhost:3010/health/ready: confirma si el consumidor está conectado a RabbitMQ.
- http://localhost:3010/: abre el panel.

Una respuesta saludable no garantiza que Clientes o el proveedor SMTP estén
disponibles. Esas conexiones se comprueban por separado.

## 6. Entrar al panel administrativo

1. Abrir http://localhost:3010/.
2. Escribir el usuario administrador y su contraseña.
3. Pulsar Iniciar sesión.
4. Consultar las notificaciones y el estado de cada correo.

En modo local se utiliza la cuenta administrador de J.
Las cuentas pedidos, pagos, inventario y facturacion no tienen acceso al panel.
Si aparece “esta cuenta no tiene acceso”, revisar que se esté usando el
administrador y no la cuenta de un módulo.

Los tokens técnicos de los módulos duran 30 minutos. La sesión administrativa
local tiene su propia configuración: AUTH_IDLE_SECONDS controla la inactividad
y AUTH_LIFETIME_SECONDS la duración máxima, por defecto 8 horas. La actividad
válida incluye las consultas automáticas que realiza la bandeja mientras está abierta.

El panel conserva la sesión en una cookie HttpOnly. No hace falta copiar el JWT.
En HTTP local usar AUTH_SECURE_COOKIE=false; en un despliegue HTTPS, true.

### Acceso con usuarios del Grupo F

USER_AUTH_MODE=clientes delega el inicio de sesión a Clientes.
Exige CLIENTES_JWT_SECRET y CLIENTES_JWT_ISSUER acordados por canal privado;
CLIENTES_JWT_AUDIENCE se configura si el equipo acuerda audiencia.

J comprueba la firma, el identificador, el vencimiento, el emisor y el rol firmado.
Solo administrador tiene permiso sobre esta bandeja. Cliente y operador reciben 403.
Una cuenta técnica de F para consultar correos no otorga acceso administrativo.

Las últimas pruebas de la cuenta técnica de Clientes confirmaron login y
consultas de destinatarios, con un 401 intermitente informado al Grupo F.
Los tokens observados incluían sub, iat y exp. No dar por verificado el acceso
administrativo central hasta comprobar que F emite también el rol y el emisor.
No desactivar esas validaciones para aceptar un token incompleto.
Ver [contrato de usuarios de Clientes](docs/INTEGRACION-CLIENTES.md).

## 7. Manual para los otros grupos: conexión con JWT por RabbitMQ

Este es el flujo recomendado para enviar eventos con respuesta autenticada.
No requiere que un integrante abra Postman o entre al panel para cada envío.

### Paso 1. Recibir la cuenta individual

Cada grupo recibe únicamente su usuario y contraseña de Notificaciones.

- pedidos puede enviar PedidoCreado.
- pagos puede enviar PagoAprobado y PagoRechazado.
- inventario puede enviar InventarioInsuficiente.
- facturacion puede enviar FacturaGenerada.

No compartir la cuenta administrador ni el archivo completo de credenciales.
Estos usuarios ya tienen permisos definidos; no se registran desde el frontend.

### Paso 2. Preparar el .env del módulo que envía

Copiar [examples/.env.worker.example](examples/.env.worker.example) a un archivo
privado .env.worker del proyecto que enviará los eventos. Completar:

```dotenv
RABBITMQ_URL=amqps://USUARIO_BROKER:CONTRASENA_BROKER@HOST/VHOST
NOTIFICACIONES_RPC_USERNAME=USUARIO_ASIGNADO_AL_MODULO
NOTIFICACIONES_RPC_PASSWORD=CONTRASENA_ASIGNADA_AL_MODULO
NOTIFICACIONES_RPC_LOGIN_QUEUE=notificaciones.auth.login
NOTIFICACIONES_RPC_QUEUE=notificaciones.eventos
```

Todos deben utilizar el mismo broker y virtual host que atiende J.
No poner aquí las credenciales de Clientes: se utiliza la cuenta que J asignó
al grupo que va a enviar. El archivo real no se publica en GitHub.

### Paso 3. Incorporar el cliente en el programa

Para Node.js se entrega [notificaciones-rpc.js](examples/notificaciones-rpc.js).
Copiarlo al proyecto del módulo e instalar amqplib si todavía no está disponible:

```powershell
npm install amqplib
```

El ejemplo utiliza módulos ES de JavaScript. Integrarlo según la estructura
del proyecto. Crear una instancia y conservarla mientras el worker esté encendido:

```js
import { NotificacionesRpc } from './notificaciones-rpc.js';

const notificaciones = NotificacionesRpc.fromEnv();
```

Al arrancar el programa, cargar .env.worker mediante Node:

```powershell
node --env-file=.env.worker ruta/al/worker.js
```

Después de realizar la operación real del módulo, enviar su evento:

```js
const resultado = await notificaciones.send({
  evento: 'PagoAprobado',
  pedidoId: pedidoReal.id,
  clienteId: pedidoReal.clienteId,
  pagoId: pagoReal.id,
  total: pagoReal.total,
  fecha: fechaDelEvento
});
```

pedidoReal, pagoReal y fechaDelEvento representan los datos de la operación
del programa. No son variables proporcionadas por Notificaciones.

Guardar el evento pendiente y gestionar los errores de red en el módulo de
origen. Reintentar con el mismo contenido, incluyendo la misma fecha, para que
Notificaciones pueda reconocerlo como duplicado.

Una vez incorporado el cliente, las cuentas de cada instalación se cambian en
el .env; no se escribe la contraseña ni el token dentro del código.
Python, PHP u otros lenguajes deben implementar el contrato RPC del paso siguiente.

### Paso 4. Qué realiza automáticamente el cliente

1. Envía usuario y contraseña a notificaciones.auth.login.
2. Recibe el JWT y su duración.
3. Lo guarda en memoria y lo reutiliza.
4. Adjunta el JWT al enviar el evento a notificaciones.eventos.
5. Si el token venció, solicita otro antes de enviar.
6. Si la respuesta es 401, renueva y reintenta una sola vez.
7. Si la respuesta es 403, informa el error: renovar no cambia los permisos.

Los 30 minutos son la duración máxima del token técnico. No se genera otro
por el simple paso del tiempo: el cliente lo solicita cuando vuelve a necesitarlo.
No hay que pedir nuevos tokens al administrador ni copiarlos manualmente.
Si el programa se reinicia, el próximo envío obtiene otro token con el mismo .env.

### Paso 5. Contrato RPC para cualquier lenguaje

**Login:** publicar JSON en la cola notificaciones.auth.login:

```json
{
  "usuario": "CUENTA_ASIGNADA",
  "password": "CONTRASENA_ASIGNADA"
}
```

Respuesta de éxito, con el mismo formato básico del README de Clientes:

```json
{
  "status": 200,
  "data": {
    "token": "<JWT_GENERADO_POR_NOTIFICACIONES>",
    "tipo": "Bearer",
    "expira_en_segundos": 1800
  }
}
```

La respuesta también conserva campos adicionales y aliases para clientes anteriores.
El texto <JWT_GENERADO_POR_NOTIFICACIONES> es ilustrativo, no un token válido.

**Envío:** publicar el evento JSON en notificaciones.eventos y añadir en las
propiedades AMQP, separado del cuerpo:

```js
headers: {
  Authorization: 'Bearer ' + token
}
```

En ambas solicitudes utilizar el exchange por defecto, routing key igual al nombre
de la cola, replyTo con una cola temporal exclusiva generada por RabbitMQ y un
correlationId único. Leer únicamente la respuesta con ese correlationId.
El cliente entregado ya hace todo esto y utiliza timeout.

El campo status de la respuesta RPC se interpreta igual que un código HTTP,
pero la solicitud viaja por RabbitMQ, no por una URL web.

Respuesta de creación: status 201 y data.notification/data.duplicate.
Respuesta de duplicado: status 200 y duplicate=true, sin crear otra notificación.
Errores: status 400, 401, 403 o 500 con un mensaje de error.

Las colas RPC tienen TTL de 15 segundos y límite de 100 solicitudes; no son
una outbox persistente del productor. Si el worker no responde o se pierde la
conexión, el origen debe conservar el evento para reintentar.
El broker debe limitar quién publica y quién consume estas colas.

### Paso 6. Probar un evento y verlo en el panel

Desde este proyecto, con .env.worker configurado para la cuenta pagos:

```powershell
node --env-file=.env.worker scripts/publish.js examples/PagoAprobado.json
```

Este comando crea una notificación real en el entorno configurado.
Para la demostración, acordar los datos de prueba y evitar correos no deseados.
No ejecutarlo indiscriminadamente en los exchanges compartidos del negocio.

El comando informa el id y si fue duplicado. Entrar con el administrador al
panel, pulsar Actualizar y buscar ese pedido/tipo de evento. La bandeja también
realiza consultas periódicas mientras está visible.

No enviar el mismo hecho por RPC y por otro canal con contenido diferente:
podría crear notificaciones distintas. Elegir una vía de envío para esa operación.

## 8. Alternativa: probar las APIs HTTP con Postman

El acceso por HTTP es otra opción; no es necesario utilizar ambas vías.

### Obtener token técnico

Crear una solicitud POST:

```text
http://localhost:3010/api/auth/module-login
```

En Body seleccionar raw y JSON:

```json
{
  "username": "CUENTA_ASIGNADA",
  "password": "CONTRASENA_ASIGNADA"
}
```

La API HTTP usa username; el RPC usa usuario. No confundir sus formatos.
La respuesta HTTP contiene access_token. Copiar únicamente ese valor.

### Enviar el evento

Crear otra solicitud POST:

```text
http://localhost:3010/api/eventos
```

En Authorization seleccionar Bearer Token y pegar el access_token.
Postman agrega Bearer; no escribirlo otra vez en ese campo.

En Body seleccionar raw/JSON y colocar el evento. Ejemplo para la cuenta pagos:

```json
{
  "evento": "PagoAprobado",
  "pedidoId": 900001,
  "clienteId": 1,
  "pagoId": 1001,
  "total": 10000,
  "fecha": "2026-10-20T12:00:00-05:00"
}
```

Son datos ilustrativos: preparar datos de prueba válidos para el entorno real.
Esperar 201 al crear o 200 al repetir exactamente el evento ya registrado.

Abrir una URL en la barra del navegador hace GET, no POST. Por eso escribir
/api/auth/module-login en la barra no ejecuta el login y puede mostrar 404.

**Localhost pertenece al equipo que realiza la solicitud.** El localhost de un
compañero no apunta a tu computador. Para HTTP entre equipos hace falta una
dirección accesible de J; para el RPC descrito basta que ambos alcancen el mismo
broker/vhost y que Notificaciones esté encendido.

Para las pruebas de seguridad del laboratorio, importar la colección de
[postman/](postman/README.md). No publicar un entorno que contenga tokens reales.

## 9. Qué datos debe incluir un evento

Todos requieren evento, pedidoId, clienteId y fecha ISO válida.
Los identificadores son enteros positivos.

PedidoCreado requiere además total no negativo y una lista productos con
productoId, cantidad positiva y precio no negativo. Ejemplo:

```json
{
  "evento": "PedidoCreado",
  "pedidoId": 900002,
  "clienteId": 1,
  "fecha": "2026-10-20T12:00:00-05:00",
  "total": 10000,
  "productos": [
    { "productoId": 1, "cantidad": 1, "precio": 10000 }
  ]
}
```

Los archivos [examples/](examples/) muestran los cinco eventos admitidos.
El grupo debe enviar únicamente los eventos autorizados a su cuenta.

## 10. Eventos de los exchanges compartidos

Se conserva la integración existente:

- Pedidos: pedidos_exchange, fanout, PedidoCreado.
- Pagos: pagos_exchange, topic, pago.aprobado y pago.rechazado.
- Inventario: inventario_exchange, fanout, InventarioInsuficiente.
- Facturación: facturacion_exchange, fanout, FacturaGenerada.

J utiliza su propia cola grupo-j.notificaciones. No consume las colas de los
demás módulos. Guarda antes de confirmar ACK y evita duplicados por contenido.
Los mensajes inválidos se rechazan hacia su cola de errores propia.

Si se decide exigir JWT también en esos exchanges, activar
RABBITMQ_REQUIRE_EVENT_JWT=true después de coordinarlo con los productores.
El ACK de publicación de RabbitMQ no confirma que J haya autorizado el evento.
Para recibir una respuesta de autorización y renovar tras 401, utilizar send(event)
hacia la cola RPC autenticada.

## 11. Configurar la consulta de correos y SMTP

Notificaciones no consulta directamente la base de otro grupo. Pide los datos
del destinatario a Clientes con su cuenta técnica:

```dotenv
CLIENTES_RPC_USERNAME=CUENTA_QUE_F_ASIGNO_A_NOTIFICACIONES
CLIENTES_RPC_PASSWORD=CONTRASENA_ASIGNADA_POR_F
CLIENTES_RPC_LOGIN_QUEUE=auth.login
CLIENTES_RPC_QUEUE=cliente.consultar
CLIENTES_RPC_TIMEOUT_MS=10000
```

Si Clientes usa otro broker, definir CLIENTES_RABBITMQ_URL. Si está vacío,
se utiliza RABBITMQ_URL. La lógica obtiene y cachea el token de F y renueva
una vez tras 401. Repetidos 401 requieren revisar las cuentas o workers de F.

Para activar correo:

```dotenv
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=CUENTA_REMITENTE
SMTP_PASSWORD=CONTRASENA_DE_APLICACION
SMTP_FROM=CUENTA_REMITENTE
EMAIL_MAX_ATTEMPTS=5
```

Gmail requiere contraseña de aplicación. En puerto 587 se exige STARTTLS.
Cambiar la configuración obliga a recrear el contenedor:

```powershell
docker compose --env-file .env.integracion -f docker-compose.integracion.yml up -d
```

Solo los trabajos nuevos se programan cuando el correo está habilitado.
Cambiar las credenciales no reinicia automáticamente trabajos que ya terminaron
como fallidos.

## 12. Interpretar el estado del correo

- **Correo pendiente:** existe un trabajo pendiente de envío o reintento.
- **Intentos fallidos:** número de intentos que no se completaron.
- **Próximo intento:** hora prevista para volver a probar automáticamente.
- **Clientes no respondió:** no se obtuvo el destinatario dentro del tiempo permitido.
- **Correo aceptado por el proveedor:** SMTP aceptó el mensaje; no confirma entrega ni lectura.
- **Correo fallido:** se agotaron los intentos configurados.
- **Correo no programado:** la notificación no tiene un trabajo de correo asociado.

Que aparezca la notificación en el panel confirma su recepción y guardado.
No significa por sí solo que el correo haya llegado a la bandeja del cliente.
Una aceptación SMTP tampoco garantiza entrega exactamente una vez ante fallos.

## 13. Errores frecuentes

**401:** falta el token, venció, fue alterado o su firma/sesión no es válida.
Usar el login del servicio correspondiente. Un token de Clientes no sustituye
al token técnico de J para enviar eventos a J.

**403:** la cuenta está autenticada, pero no tiene permiso para la operación.
Por ejemplo, pedidos no puede enviar FacturaGenerada ni consultar la bandeja.

**404:** revisar ruta y método. Los logins y envíos HTTP son POST.

**400:** revisar JSON, campos obligatorios, identificadores y fecha.

**429:** se agotó el límite de intentos de login. No pedir un token en cada
evento; reutilizarlo y respetar el tiempo de bloqueo.

**No responde el RPC:** comprobar broker, virtual host, cola, red y worker encendido.
No declarar colas de operación ajenas con parámetros diferentes.
No utilizar notificaciones.auth.login como si fuera un enlace HTTPS.

**RabbitMQ desconectado:** revisar /health/ready y los registros del contenedor.
No publicar la URL AMQPS completa al pedir ayuda: contiene credenciales.

**Login correcto y consulta a Clientes con 401:** comprobar que los workers
de Clientes compartan la configuración de verificación. El síntoma por sí solo
no confirma cuál es la causa.

**Un módulo no entra al panel:** es el comportamiento esperado; usar administrador.

## 14. Datos, reinicios y contraseñas

El motor activo es SQLite; el SQL MySQL incluido es de referencia.
Compose conserva datos en ./data. No eliminar esa carpeta para reiniciar el servicio.
No borrar el volumen Kubernetes durante la demostración de recuperación.

Para rotar una cuenta técnica local, de forma intencional:

```powershell
node --env-file=.env.integracion scripts/manage-access.js rotate pagos
```

Actualizar después el .env.worker del grupo afectado. Rotar la contraseña
invalida sus sesiones anteriores. No ejecutar rotate para solucionar un 403
causado por permisos de evento.

JWT_SECRET, contraseñas, tokens, archivos .env reales y credenciales-modulos.json
permanecen privados. Entregar a cada grupo únicamente su propia cuenta.
JWT no reemplaza los permisos de acceso al broker.

## 15. Kubernetes y pruebas del laboratorio

Se incluyen Deployment, Service, PVC, ConfigMap y plantilla de Secret.
La imagen de referencia es grupo-j-notificaciones:2.0.0.
El Deployment usa una réplica por la persistencia SQLite y el worker de correo.

Seguir [docs/KUBERNETES.md](docs/KUBERNETES.md). El perfil de laboratorio utiliza
cola y datos separados del servicio habitual. No compite con la cola del negocio.

La recuperación se comprueba eliminando el Pod de laboratorio, esperando el
reemplazo y consultando nuevamente la notificación persistida.
No se necesita contratar AWS: el laboratorio permite Minikube o Kubernetes local.

Pruebas locales y de manifiestos:

```powershell
npm ci
npm test
npm run check:k8s
```

Prueba RPC real aislada, únicamente en el broker autorizado:

```powershell
node --env-file=.env.integracion --test tests/integration/authRpc.test.js
```

La última validación del flujo técnico incluyó 42 pruebas locales aprobadas,
una prueba RPC real aislada y comprobación del token desplegado de 1.800 segundos.
Las pruebas de renovación simulan el paso del tiempo; no esperan 30 minutos reales.

Consultar [docs/LABORATORIO.md](docs/LABORATORIO.md) para las evidencias de fases
anteriores y su alcance. Una prueba aislada no certifica todas las operaciones
entre los nueve servicios ni el login administrativo central de F.

## 16. Lista final para conectar un grupo

1. Notificaciones está encendido y conectado al broker.
2. El grupo tiene acceso al mismo broker y virtual host.
3. Recibió su cuenta individual de J.
4. Configuró su .env.worker privado.
5. Incorporó el cliente RPC o implementó el contrato en su lenguaje.
6. Envía un evento autorizado con datos válidos.
7. Recibe respuesta de éxito y verifica el resultado en el panel con administrador.
8. Conserva/reintenta los eventos pendientes ante fallos de red.

Con el cliente ya integrado, los cambios de usuario, contraseña o dirección del
broker se realizan en el entorno. No se reparten tokens nuevos manualmente.

Para consultar todas las variables, ver [configuraciones.txt](configuraciones.txt).

## Verificacion del entorno actualizado

El archivo `.env` real se conserva en la carpeta local y queda excluido de Git.
Las plantillas `.env.example` y `.env.integracion.example` documentan las variables
sin publicar las credenciales. No reemplazar un entorno existente por la plantilla.

Ejecutar `npm run check:env` para revisar `.env`, o
`npm run check:env -- .env.integracion` para revisar el perfil de integracion.
Esta comprobacion valida configuracion; no certifica disponibilidad de Clientes,
RabbitMQ o SMTP ni envia correos.

En esta instalacion local, Node utiliza el puerto 3010 para evitar conflictos con
Bunker Gym en 3000. Docker mantiene el puerto interno 3000 y publica HOST_PORT.
`docker-compose.yml` transmite tambien las variables SMTP, TLS y fuentes RabbitMQ;
el perfil de integracion utiliza el broker compartido y requiere AMQPS.

```powershell
npm run check:env
npm start
# Alternativa con el broker compartido y Docker:
docker compose --env-file=.env.integracion -f docker-compose.integracion.yml up -d --build
```
