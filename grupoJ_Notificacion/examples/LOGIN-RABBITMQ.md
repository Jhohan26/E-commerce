# Conexión a Notificaciones por RabbitMQ

Notificaciones crea una cuenta técnica distinta para cada microservicio que
consume sus eventos: pedidos, pagos, inventario y facturacion. Cada equipo
recibe solo su usuario y contraseña, por un canal privado. No compartir el JSON
completo, la cuenta administrador ni credenciales en GitHub o chats grupales.
La cuenta de cada módulo solo obtiene permisos para sus propios eventos.

Estas credenciales de aplicación son distintas de las credenciales AMQPS del
broker. Cada equipo también necesita su propio usuario de CloudAMQP, asignado
por quien administre el broker. El login de esta guía no da acceso al panel.
Notificaciones debe permanecer ejecutándose y conectado para responder.

Para activar el endpoint en Docker de integración, configura
`RABBITMQ_AUTH_RPC_ENABLED=true` (la plantilla de integración ya lo habilita).
Esto permite solicitar el JWT sin exigir todavía que todos adjunten el token a
cada evento. `RABBITMQ_REQUIRE_EVENT_JWT=true` es un control separado: solo se
activa después de coordinarlo con todos los productores.

Las cuentas se crean localmente con `node scripts/manage-access.js bootstrap`.
Para cambiar una contraseña expuesta, usa
`node scripts/manage-access.js rotate <cuenta>` y comparte la nueva solo con el
equipo correspondiente. El archivo `.artifacts/credenciales-modulos.json` está
excluido de Git y no debe publicarse.

1. Crear una cola de respuesta exclusiva con nombre generado por RabbitMQ.
2. Enviar al exchange por defecto (`""`), routing key `notificaciones.auth.login`:

```json
{"username":"pagos","password":"<contraseña individual>"}
```

Propiedades AMQP: `replyTo` = cola generada, `correlationId` = UUID,
`expiration` = `15000`, `persistent` = `false`, `mandatory` = `true`.
Esperar la respuesta con el mismo `correlationId` durante 10 segundos.

3. Si `status` es `200`, guardar `data.access_token` en memoria.
4. Publicar el evento en el exchange habitual con la propiedad AMQP
`headers: { Authorization: "Bearer <access_token>" }`.

El token caduca tras 30 minutos sin eventos autorizados o al cumplir 8 horas.
Solicitar otro token con las mismas credenciales antes de alcanzar esos límites.
No hace falta que el administrador entregue manualmente nuevos tokens.
La respuesta del login tiene `expiresAt` e `inactivitySeconds`.
Un ACK de publicación del broker no confirma que J haya autorizado el evento.

## Ejemplo Node.js

Instalar `amqplib` y copiar `notificaciones-rpc.js` al proyecto. Definir en el
entorno privado `RABBITMQ_URL`, `NOTIFICACIONES_USERNAME` y
`NOTIFICACIONES_PASSWORD`. Nunca subir sus valores a Git.

```js
import amqp from 'amqplib';
import { NotificacionesRpc } from './notificaciones-rpc.js';

const cliente = new NotificacionesRpc({
  url: process.env.RABBITMQ_URL,
  username: process.env.NOTIFICACIONES_USERNAME,
  password: process.env.NOTIFICACIONES_PASSWORD
});
const conexion = await amqp.connect(process.env.RABBITMQ_URL, {
  rejectUnauthorized: true
});
const canal = await conexion.createConfirmChannel();
try {
  await cliente.publish(canal, 'pagos_exchange', 'pago.aprobado', {
    evento: 'PagoAprobado', pedidoId: 123, clienteId: 1,
    pagoId: 456, total: 10000, fecha: new Date().toISOString()
  });
} finally {
  await conexion.close();
}
```

Integrar la publicación al pago real. El ejemplo crea una notificación real si
se ejecuta contra el entorno compartido; no ejecutarlo como prueba indiscriminada.
En una aplicación mantener el cliente para reutilizar su token y gestionar los
errores de conexión y cierre del canal según el ciclo de vida del servicio.

Pedidos publica `PedidoCreado`; Pagos, `PagoAprobado` y `PagoRechazado`;
Inventario, `InventarioInsuficiente`; Facturación, `FacturaGenerada`.
El administrador usa el panel HTTP; su cuenta no obtiene tokens por esta cola.
El administrador del broker debe restringir la escritura a la cola de login a
los usuarios autorizados y reservar el consumo de la cola a Notificaciones.
