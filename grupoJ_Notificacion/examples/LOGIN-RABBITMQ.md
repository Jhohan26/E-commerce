# Conexión a Notificaciones por RabbitMQ

Cada grupo recibe su usuario y contraseña de Notificaciones y acceso AMQPS al
mismo broker y virtual host. No necesita entrar al panel ni usar Postman.
Notificaciones debe permanecer ejecutándose para responder al login.

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
El administrador del broker debe reservar el consumo de la cola de login a J.
