<?php
declare(strict_types=1);
use Pagos\{Broker, Order, PaymentEvent, PaymentRepository, Processor};
require dirname(__DIR__) . '/bootstrap.php';

// Opt-in: usa SOLO una tabla temporal, que desaparece al cerrar esta conexión.
$dsn = getenv('PAGOS_TEST_DSN');
if (!$dsn) { fwrite(STDERR, "Define PAGOS_TEST_DSN para ejecutar las pruebas MySQL de decisiones manuales.\n"); exit(2); }
$pdo = new PDO($dsn, getenv('PAGOS_TEST_USER') ?: 'root', getenv('PAGOS_TEST_PASSWORD') ?: '', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
]);
$schema = file_get_contents(dirname(__DIR__) . '/database/schema.sql');
$schema = substr($schema, strpos($schema, 'CREATE TABLE pagos'));
$pdo->exec(str_replace('CREATE TABLE pagos', 'CREATE TEMPORARY TABLE pagos', $schema));
$repository = new PaymentRepository($pdo);
$checks = 0;
function verify(bool $value, string $label): void {
    global $checks;
    if (!$value) { throw new RuntimeException('FALLO: ' . $label); }
    $checks++; echo "OK $label\n";
}
function raises(callable $operation, string $class, string $label): void {
    try { $operation(); } catch (Throwable $error) { verify($error instanceof $class, $label); return; }
    verify(false, $label);
}
// Broker sin conexión: cualquier intento accidental de publicar durante la recepción fallaría.
$broker = (new ReflectionClass(Broker::class))->newInstanceWithoutConstructor();
$processor = new Processor($repository, $broker);
$body = '{"evento":"PedidoCreado","pedidoId":901,"clienteId":25,"total":95000}';
$row = $processor->process($body);
verify($row['estado'] === 'PENDIENTE' && (int) $row['evento_publicado'] === 0, 'recepcion persiste pendiente sin tocar RabbitMQ');
verify($processor->process($body)['id'] === $row['id'] && count($repository->history(null)) === 1, 'reentrega no duplica ni aprueba');
raises(fn() => $processor->process(str_replace('95000', '95001', $body)), InvalidArgumentException::class, 'reentrega con importe distinto conserva original');
verify($repository->pending(100) === [], 'recuperacion excluye pagos sin decision');
verify(!$repository->publishPending((int) $row['id'], fn() => throw new RuntimeException('No debe publicar')), 'publicacion directa tambien excluye pendientes');
raises(fn() => $repository->decide(999, 'APROBADO'), InvalidArgumentException::class, 'no permite pagar pedidos inexistentes');
raises(fn() => $repository->decide(901, 'OTRO'), InvalidArgumentException::class, 'no acepta estados arbitrarios');
raises(fn() => $repository->decide(901, 'RECHAZADO', ' '), InvalidArgumentException::class, 'rechazo necesita motivo');
raises(fn() => $repository->decide(901, 'RECHAZADO', str_repeat('á', 151)), InvalidArgumentException::class, 'limite del motivo en caracteres');
$approved = $repository->decide(901, 'APROBADO');
verify($approved['estado'] === 'APROBADO' && $approved['motivo_rechazo'] === null, 'boton pagar guarda aprobacion');
verify(PaymentEvent::fromRow($approved)['evento'] === 'PagoAprobado', 'JSON de aprobacion compatible');
verify($repository->decide(901, 'APROBADO') === $approved, 'doble clic conserva fecha y resultado');
raises(fn() => $repository->decide(901, 'RECHAZADO', 'Cambio tardio'), DomainException::class, 'no permite decision contradictoria');
verify($repository->register(new Order(901, 25, '95000.00')) === $approved, 'reentrega posterior no reinicia el pago');
raises(fn() => $repository->publishPending((int) $approved['id'], fn() => throw new RuntimeException('Broker caido')), RuntimeException::class, 'fallo del broker deja evento recuperable');
verify($repository->history(901)[0] === $approved, 'fallo de publicacion no revierte decision guardada');
verify($repository->pending(100) === [(int) $approved['id']], 'recuperacion encuentra resultado no publicado');
$events = [];
verify($repository->publishPending((int) $approved['id'], function ($payment) use (&$events) { $events[] = PaymentEvent::fromRow($payment); }), 'reintento publica resultado guardado');
verify(!$repository->publishPending((int) $approved['id'], fn() => throw new RuntimeException('Duplicado')), 'resultado confirmado no se publica de nuevo');
verify(count($events) === 1 && (int) $repository->history(901)[0]['evento_publicado'] === 1, 'marca confirmado despues del envio');
$repository->register(new Order(902, 25, '10.25'));
$rejected = $repository->decide(902, 'RECHAZADO', '  Rechazo manual  ');
verify($rejected['estado'] === 'RECHAZADO' && $rejected['motivo_rechazo'] === 'Rechazo manual', 'boton rechazar guarda motivo');
verify($repository->decide(902, 'RECHAZADO', 'Otro motivo') === $rejected, 'doble rechazo conserva motivo original');
raises(fn() => $repository->decide(902, 'APROBADO'), DomainException::class, 'rechazo final no se aprueba despues');
$event = PaymentEvent::fromRow($rejected);
verify($event['evento'] === 'PagoRechazado' && $event['motivo'] === 'Rechazo manual' && $event['pedidoId'] === 902, 'JSON de rechazo compatible');
$pending = $repository->register(new Order(903, 25, '1.00'));
raises(fn() => PaymentEvent::fromRow($pending), RuntimeException::class, 'pendiente nunca se convierte en evento de resultado');
verify($repository->pending(100) === [(int) $rejected['id']], 'recuperacion distingue pendiente manual de envio pendiente');
$awaiting = $repository->awaitingDecision();
verify($awaiting['total'] === 1 && count($awaiting['rows']) === 1 && (int) $awaiting['rows'][0]['pedido_id'] === 903,
    'panel lateral incluye solo pendientes y excluye aprobados y rechazados sin publicar');
$repository->decide(903, 'APROBADO');
verify($repository->awaitingDecision() === ['rows' => [], 'total' => 0], 'pedido resuelto desaparece del panel de pendientes');
echo "$checks comprobaciones correctas con MySQL; tabla temporal y sin RabbitMQ.\n";
