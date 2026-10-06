<?php
declare(strict_types=1);

use Pagos\Broker;
$config = require dirname(__DIR__) . '/bootstrap.php';
$suffix = bin2hex(random_bytes(8));
$exchange = 'pagos.test.' . $suffix;
$input = $exchange . '.input'; $output = $exchange . '.output';
$notificationQueue = $exchange . '.notificaciones';
putenv('AMQP_EXCHANGE=' . $exchange);
putenv('AMQP_QUEUE=' . $input);
putenv('AMQP_DEMO_QUEUE=' . $output);
putenv('AMQP_KEY_INPUT=pedido.creado');
putenv('AMQP_KEY_APPROVED=pago.aprobado');
putenv('AMQP_KEY_REJECTED=pago.rechazado');
$broker = null;
function assertAmqp(bool $ok, string $label): void {
    if (!$ok) { throw new RuntimeException('FALLO: ' . $label); }
    echo "OK $label\n";
}
try {
    $broker = new Broker($config);
    $broker->setup(true);
    $body = file_get_contents(dirname(__DIR__) . '/examples/pedido-aprobado.json');
    $broker->publishRaw($body, 'pedido.creado');
    $broker->close(); $broker = null;

    $broker = new Broker($config); $broker->setup(true);
    $broker->channel->queue_declare($notificationQueue, false, true, false, false);
    foreach (['pago.aprobado', 'pago.rechazado'] as $key) { $broker->channel->queue_bind($notificationQueue, $exchange, $key); }
    $one = $broker->channel->basic_get($input, false);
    assertAmqp($one !== null && $one->getBody() === $body && $one->get('delivery_mode') === 2, 'mensaje persistente recibido tras reconectar sin consumidor previo');
    $one->nack(true, false);
    $broker->close(); $broker = null;
    $broker = new Broker($config); $broker->setup(true);
    $retry = $broker->channel->basic_get($input, false);
    assertAmqp($retry !== null && $retry->isRedelivered(), 'reentrega tras nack con requeue');
    $retry->ack();
    $broker->publishRaw($body, 'pedido.creado');
    $duplicate = $broker->channel->basic_get($input, false);
    assertAmqp($duplicate !== null && $duplicate->getBody() === $body, 'transporte de mensaje duplicado (idempotencia SQL pendiente)');
    $duplicate->ack();
    $broker->publishRaw('{', 'pedido.creado');
    $invalid = $broker->channel->basic_get($input, false);
    $invalid->reject(false);
    assertAmqp($broker->channel->basic_get($input, false) === null, 'rechazo manual sin reencolar');
    $row = ['id'=>999,'pedido_id'=>1001,'cliente_id'=>25,'total'=>'5000000.00','estado'=>'APROBADO','motivo_rechazo'=>null,'fecha_procesamiento'=>'2026-10-04 15:30:00'];
    foreach (['APROBADO', 'RECHAZADO'] as $state) {
        $row['estado'] = $state; $row['motivo_rechazo'] = $state === 'RECHAZADO' ? 'Prueba' : null;
        $broker->publishPayment($row);
        $message = $broker->channel->basic_get($output, false);
        assertAmqp($message !== null && json_decode($message->getBody(), true)['estado'] === $state && $message->get('message_id') === 'pagos:999', "publicacion confirmada y salida $state recibida");
        $message->ack();
        $notification = $broker->channel->basic_get($notificationQueue, false);
        assertAmqp($notification !== null && $notification->getBody() === $message->getBody() && $notification->get('message_id') === $message->get('message_id'), "Facturacion y Notificaciones reciben copia independiente $state");
        $notification->ack();
    }
    $failed = false;
    try { $broker->publishRaw('{}', 'sin.ruta'); } catch (RuntimeException) { $failed = true; }
    assertAmqp($failed, 'mandatory detecta evento sin destino aunque el broker confirme');
    assertAmqp($broker->isUsable(), 'devolucion aislada mantiene canal utilizable');
    $broker->publishPayment($row);
    $following = $broker->channel->basic_get($output, false);
    assertAmqp($following !== null && json_decode($following->getBody(), true)['estado'] === 'RECHAZADO', 'publicacion siguiente se confirma tras un error aislado');
    $following->ack();
    $notification = $broker->channel->basic_get($notificationQueue, false);
    assertAmqp($notification !== null && $notification->getBody() === $following->getBody(), 'ambas colas siguen recibiendo tras error aislado');
    $notification->ack();
    echo "Pruebas AMQP terminadas; sin operaciones SQL.\n";
} finally {
    if ($broker === null) { $broker = new Broker($config); }
    $broker->channel->queue_delete($input);
    $broker->channel->queue_delete($output);
    $broker->channel->queue_delete($notificationQueue);
    $broker->channel->exchange_delete($exchange);
    $broker->close();
}
