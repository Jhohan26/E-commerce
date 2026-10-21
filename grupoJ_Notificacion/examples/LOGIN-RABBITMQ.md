# Workers: mismo flujo RPC de Clientes
Cada módulo usa su propia cuenta de Notificaciones. Las cuentas existentes no
se cambiaron. El panel sigue reservado al administrador.

Copiar examples/.env.worker.example a un archivo privado .env.worker y completar
RABBITMQ_URL, NOTIFICACIONES_RPC_USERNAME y NOTIFICACIONES_RPC_PASSWORD.
La URL usa las credenciales del broker; las otras dos identifican al módulo
ante Notificaciones. Son controles diferentes.

Instalar amqplib en el proyecto del módulo y copiar examples/notificaciones-rpc.js.
Usar una instancia persistente de NotificacionesRpc.fromEnv() y llamar a send(event).

```js
import { NotificacionesRpc } from './notificaciones-rpc.js';
const notificaciones = NotificacionesRpc.fromEnv();
// Cuando la operación real del módulo finalice:
const resultado = await notificaciones.send(eventoReal);
```

Para una prueba manual explícita:
node --env-file=.env.worker scripts/publish.js examples/PagoAprobado.json
Este comando guarda una notificación real; no ejecutarlo indiscriminadamente.

## Contrato compatible con el README de Clientes
Login: cola notificaciones.auth.login.
Petición: {"usuario":"<cuenta individual>","password":"<contraseña individual>"}.
Respuesta: {"status":200,"data":{"token":"<JWT>","tipo":"Bearer","expira_en_segundos":1800}}.
Se conservan username como alias de usuario y access_token para clientes anteriores.
No se usa la cola auth.login de F para las cuentas de J.

Recepción de eventos: cola notificaciones.eventos.
Cuerpo: el evento JSON habitual. Propiedad AMQP:
headers.Authorization = "Bearer <token de Notificaciones>".
Respuesta: status=201 para creación, 200 para duplicado, 401 para sesión inválida
o vencida, 403 para evento no autorizado, 400 para contrato inválido.

Cada solicitud usa replyTo temporal exclusivo generado por RabbitMQ,
correlationId aleatorio, TTL y timeout. El cliente comprueba el status.
El token técnico dura AUTH_MODULE_LIFETIME_SECONDS=1800 (30 minutos absolutos).
No aparece un token nuevo por sí solo al pasar el tiempo: el cliente solicita
otro antes del siguiente envío si venció, y reintenta una sola vez tras un 401.
La contraseña se reutiliza desde .env; no se manda en cada evento.
Un 403 no provoca nuevos logins. Un error de red se informa al publicador;
el módulo debe guardar/reintentar sus operaciones pendientes con el mismo evento.
J deduplica reentregas por contenido: no cambiar fecha o payload en cada reintento.

En J: RABBITMQ_AUTH_RPC_ENABLED=true habilita login y recepción RPC.
AUTH_RPC_QUEUE=notificaciones.auth.login, EVENT_RPC_QUEUE=notificaciones.eventos.
Las colas RPC son temporales operativas no durables, TTL 15 segundos y máximo
100 solicitudes; no son una outbox del publicador ni sustituyen su persistencia.
El broker debe reservar su consumo a J y permitir a cada cliente consumir solo
su cola de respuesta. AMQPS cifra el transporte; el administrador del broker
puede acceder a los mensajes.

La recepción RPC siempre exige JWT, aunque RABBITMQ_REQUIRE_EVENT_JWT=false.
Este último parámetro controla los exchanges compartidos: permanece false para
no bloquear a productores que no se han actualizado. Para exigir JWT también
en esos exchanges, coordinar la migración de todos y activarlo en el entorno.
publish(channel,...) permite el modo exchange, pero el ACK del broker no confirma
autorización ni devuelve un 401 del consumidor; send(event) es el flujo recomendado.

Este acceso técnico no resuelve ni reemplaza los roles del login de usuarios F.
