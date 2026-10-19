<?php
declare(strict_types=1);

use Pagos\{Broker, PublicationException};

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$config = require dirname(__DIR__) . '/bootstrap.php';
$run = in_array('--run', $argv, true);
$checkOnly = in_array('--check', $argv, true);
if (!$run && !$checkOnly) {
    echo "Uso: php tests/rabbitmq.php --check | --run\n";
    echo "--check valida aislamiento sin conexion. --run usa recursos exclusivos pagos.test.* en el broker configurado.\n";
    exit(0);
}

$prefix = 'pagos.test.' . bin2hex(random_bytes(8));
$inputExchange = $prefix . '.pedidos';
$outputExchange = $prefix . '.pagos';
$input = $prefix . '.entrada';
$output = $prefix . '.resultados';
$notificationQueue = $prefix . '.notificaciones';
$invoiceQueue = $prefix . '.facturacion';
$overrides = [
    'RABBITMQ_EXCHANGE_PEDIDOS' => $inputExchange,
    'RABBITMQ_EXCHANGE_PAGOS' => $outputExchange,
    'AMQP_QUEUE' => $input,
    'AMQP_DEMO_QUEUE' => $output,
    'AMQP_KEY_APPROVED' => 'pago.aprobado',
    'AMQP_KEY_REJECTED' => 'pago.rechazado',
];
// Opcional: otro broker de pruebas. Nunca se modifica .env.
$testUrl = getenv('PAGOS_TEST_RABBITMQ_URL');
if ($testUrl !== false && $testUrl !== '') { $overrides['RABBITMQ_URL'] = $testUrl; }
$previous = [];
foreach ($overrides as $key => $value) {
    $previous[$key] = getenv($key);
    putenv($key . '=' . $value);
}
$broker = null;
$connected = false;
$exitCode = 0;
$checks = 0;
function assertAmqp(bool $ok, string $label): void {
    global $checks;
    if (!$ok) { throw new RuntimeException('FALLO: ' . $label); }
    $checks++; echo "OK $label\n";
}
function expectUnroutable(callable $publish): void {
    $returned = false;
    try { $publish(); } catch (PublicationException) { $returned = true; }
    assertAmqp($returned, 'mandatory informa que no existe destino enlazado');
}
try {
    foreach (['RABBITMQ_EXCHANGE_PEDIDOS', 'RABBITMQ_EXCHANGE_PAGOS', 'AMQP_QUEUE', 'AMQP_DEMO_QUEUE'] as $key) {
        assertAmqp($config->get($key) === $overrides[$key] && str_starts_with($config->get($key), $prefix . '.'), 'aislamiento efectivo de ' . $key);
    }
    assertAmqp($inputExchange !== $outputExchange, 'entrada fanout y salida topic usan exchanges diferentes');
    echo "Recursos de esta ejecucion: $prefix.*\n";
    if ($run) {
        $broker = new Broker($config);
        $connected = true;
        $broker->setup(true);
        $body = file_get_contents(dirname(__DIR__) . '/examples/pedido-aprobado.json');
        $broker->publishRaw($body);
        $broker->close(); $broker = null;
        $broker = new Broker($config);
        $one = $broker->channel->basic_get($input, false);
        assertAmqp($one !== null && $one->getBody() === $body && $one->get('delivery_mode') === 2, 'pedido persistente disponible tras reconectar sin consumidor previo');
        $one->nack(true, false);
        $broker->close(); $broker = null;
        $broker = new Broker($config);
        $retry = $broker->channel->basic_get($input, false);
        assertAmqp($retry !== null && $retry->isRedelivered(), 'reentrega tras nack con requeue');
        $retry->ack();
        $broker->publishRaw($body);
        $duplicate = $broker->channel->basic_get($input, false);
        assertAmqp($duplicate !== null && $duplicate->getBody() === $body, 'transporte de duplicados; idempotencia SQL se prueba en manual.php');
        $duplicate->ack();
        $broker->publishRaw('{');
        $invalid = $broker->channel->basic_get($input, false);
        assertAmqp($invalid !== null, 'mensaje invalido disponible para descarte');
        $invalid->reject(false);
        assertAmqp($broker->channel->basic_get($input, false) === null, 'descarte sin reencolar');

        $broker->channel->queue_declare($notificationQueue, false, true, false, false);
        $broker->channel->queue_declare($invoiceQueue, false, true, false, false);
        foreach (['pago.aprobado', 'pago.rechazado'] as $key) {
            $broker->channel->queue_bind($notificationQueue, $outputExchange, $key);
        }
        $broker->channel->queue_bind($invoiceQueue, $outputExchange, 'pago.aprobado');
        $row = ['id'=>999, 'pedido_id'=>1001, 'cliente_id'=>25, 'total'=>'5000000.00',
            'estado'=>'APROBADO', 'motivo_rechazo'=>null, 'fecha_procesamiento'=>'2026-10-04 15:30:00'];
        foreach (['APROBADO', 'RECHAZADO'] as $state) {
            $row['estado'] = $state;
            $row['motivo_rechazo'] = $state === 'RECHAZADO' ? 'Prueba aislada' : null;
            $broker->publishPayment($row);
            $message = $broker->channel->basic_get($output, false);
            $expectedEvent = $state === 'APROBADO' ? 'PagoAprobado' : 'PagoRechazado';
            $event = $message === null ? [] : json_decode($message->getBody(), true, 512, JSON_THROW_ON_ERROR);
            assertAmqp($message !== null && ($event['evento'] ?? '') === $expectedEvent && ($event['estado'] ?? '') === $state
                && $message->get('message_id') === 'pagos:999' && $message->get('delivery_mode') === 2, "JSON y mensaje persistente de $state");
            if ($state === 'RECHAZADO') { assertAmqp(($event['motivo'] ?? '') === 'Prueba aislada', 'JSON rechazado incluye motivo'); }
            $message->ack();
            $notification = $broker->channel->basic_get($notificationQueue, false);
            assertAmqp($notification !== null && $notification->getBody() === $message->getBody(), "cola simulada de notificaciones recibe $state");
            $notification->ack();
            $invoice = $broker->channel->basic_get($invoiceQueue, false);
            if ($state === 'APROBADO') {
                assertAmqp($invoice !== null && $invoice->getBody() === $message->getBody(), 'cola simulada de facturacion recibe aprobados');
                $invoice->ack();
            } else { assertAmqp($invoice === null, 'cola simulada de facturacion NO recibe rechazados'); }
        }

        // Topic: quitar todos los destinos de la clave rechazada, conservando la de aprobacion.
        foreach ([$output, $notificationQueue] as $queue) { $broker->channel->queue_unbind($queue, $outputExchange, 'pago.rechazado'); }
        expectUnroutable(fn() => $broker->publishPayment($row));
        assertAmqp($broker->isUsable(), 'retorno sin destino no inutiliza el canal');
        foreach ([$output, $notificationQueue] as $queue) { $broker->channel->queue_bind($queue, $outputExchange, 'pago.rechazado'); }
        $broker->publishPayment($row);
        foreach ([$output, $notificationQueue] as $queue) {
            $message = $broker->channel->basic_get($queue, false);
            assertAmqp($message !== null && json_decode($message->getBody(), true)['estado'] === 'RECHAZADO', 'envio posterior funciona tras restablecer binding');
            $message->ack();
        }
        // Fanout ignora las routing keys: para probar falta de destino se retira el binding.
        $broker->channel->queue_unbind($input, $inputExchange, '');
        expectUnroutable(fn() => $broker->publishRaw($body));
        $broker->channel->queue_bind($input, $inputExchange, '');
        $broker->publishRaw($body, 'clave.ignorada.por.fanout');
        $message = $broker->channel->basic_get($input, false);
        assertAmqp($message !== null && $message->getBody() === $body, 'entrada fanout entrega al restaurar el binding');
        $message->ack();
    }
    echo "$checks comprobaciones correctas. Sin operaciones SQL ni uso de colas reales de los grupos.\n";
} catch (Throwable $error) {
    // No imprimir errores de conexion que pudieran incluir credenciales.
    $safeMessage = str_starts_with($error->getMessage(), 'FALLO: ') ? $error->getMessage() : 'No se completo la prueba. Revisa conexion, permisos del broker y dependencias.';
    fwrite(STDERR, $safeMessage . "\n");
    $exitCode = 1;
} finally {
    if ($broker !== null) { try { $broker->close(); } catch (Throwable) {} }
    if ($connected) {
        $cleanup = null;
        try {
            $cleanup = new Broker($config);
            foreach (['queue' => [$input, $output, $notificationQueue, $invoiceQueue], 'exchange' => [$inputExchange, $outputExchange]] as $kind => $names) {
                foreach ($names as $name) {
                    $channel = null;
                    try {
                        if (!str_starts_with($name, $prefix . '.')) { throw new LogicException('Recurso fuera del espacio de prueba'); }
                        $channel = $cleanup->connection->channel();
                        if ($kind === 'queue') { $channel->queue_delete($name); }
                        else { $channel->exchange_delete($name); }
                    } catch (Throwable) {
                        fwrite(STDERR, "No se pudo limpiar recurso de prueba: $name\n");
                        $exitCode = 1;
                    } finally { if ($channel !== null && $channel->is_open()) { try { $channel->close(); } catch (Throwable) {} } }
                }
            }
            if ($exitCode === 0) { echo "Recursos temporales eliminados.\n"; }
        } catch (Throwable) {
            fwrite(STDERR, "Limpieza incompleta; revisar solo recursos $prefix.* en RabbitMQ.\n");
            $exitCode = 1;
        } finally { if ($cleanup !== null) { try { $cleanup->close(); } catch (Throwable) {} } }
    }
    foreach ($previous as $key => $value) { $value === false ? putenv($key) : putenv($key . '=' . $value); }
}
exit($exitCode);
