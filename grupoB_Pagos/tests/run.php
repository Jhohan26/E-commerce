<?php
declare(strict_types=1);
use Pagos\{Config, Order, Money, Simulator, PaymentEvent};
require dirname(__DIR__) . '/bootstrap.php';
$count = 0;
function check(bool $ok, string $label): void {
    global $count;
    if (!$ok) { throw new RuntimeException('FALLO: ' . $label); }
    $count++; echo "OK $label\n";
}
function invalid(callable $operation, string $label): void {
    try { $operation(); } catch (InvalidArgumentException) { check(true, $label); return; }
    check(false, $label);
}

$testConfig = tempnam(sys_get_temp_dir(), 'pagos');
$simulationEnvironment = [];
foreach (['PAYMENT_REJECT_ORDER_IDS', 'PAYMENT_REJECTION_REASON', 'PAYMENT_MODE', 'PAYMENT_LIMIT'] as $key) { $simulationEnvironment[$key] = getenv($key); }
try {
    foreach (array_keys($simulationEnvironment) as $key) { putenv($key); }
    file_put_contents($testConfig, '');
    $simulator = new Simulator(new Config($testConfig));
    $approved = Order::fromJson(file_get_contents(dirname(__DIR__) . '/examples/pedido-aprobado.json'));
    $rejected = Order::fromJson(file_get_contents(dirname(__DIR__) . '/examples/pedido-rechazado.json'));
    check($simulator->decide($approved) === ['estado'=>'APROBADO','motivo_rechazo'=>null], 'aprobacion normal sin motivo');
    check($simulator->decide($rejected)['estado'] === 'APROBADO', 'importe mayor a cinco millones aprobado normalmente');
    check($simulator->decide($approved) === $simulator->decide($approved), 'simulacion determinista');
    foreach (['0.01','4999999.99','5000000.00','5000000.01','9999999999.99'] as $total) {
        check($simulator->decide(new Order(1002,26,$total))['estado'] === 'APROBADO', "aprobacion independiente del importe $total");
    }
    file_put_contents($testConfig, "PAYMENT_REJECT_ORDER_IDS=1002, 42,1002\nPAYMENT_REJECTION_REASON=Rechazo de prueba\n");
    $testSimulator = new Simulator(new Config($testConfig));
    check($testSimulator->decide($rejected) === ['estado'=>'RECHAZADO','motivo_rechazo'=>'Rechazo de prueba'], 'pedido configurado produce rechazo de laboratorio');
    check($testSimulator->decide($rejected) === $testSimulator->decide($rejected), 'rechazo reproducible con duplicados en lista');
    check($testSimulator->decide($approved)['estado'] === 'APROBADO', 'pedido fuera de lista aprobado');
    foreach (['0.01','9999999999.99'] as $total) {
        check($testSimulator->decide(new Order(1002,26,$total))['estado'] === 'RECHAZADO', "rechazo por ID independiente del importe $total");
    }
    check($testSimulator->decide(new Order(42,26,'0.01'))['estado'] === 'RECHAZADO', 'multiples IDs configurados');
    check($testSimulator->decide(new Order(420,26,'0.01'))['estado'] === 'APROBADO', 'coincidencia exacta de ID');
    putenv('PAYMENT_REJECT_ORDER_IDS=1001');
    $environmentSimulator = new Simulator(new Config($testConfig));
    check($environmentSimulator->decide($approved)['estado'] === 'RECHAZADO' && $environmentSimulator->decide($rejected)['estado'] === 'APROBADO', 'lista de entorno tiene prioridad');
    putenv('PAYMENT_REJECT_ORDER_IDS');
    foreach (['', '   '] as $ids) {
        file_put_contents($testConfig, "PAYMENT_REJECT_ORDER_IDS=$ids\n");
        check((new Simulator(new Config($testConfig)))->decide($rejected)['estado'] === 'APROBADO', 'lista vacia deshabilita rechazos de prueba');
    }
    foreach (['0','-1','2147483648','1.5','abc','1,,2','1,','01','1;2'] as $ids) {
        file_put_contents($testConfig, "PAYMENT_REJECT_ORDER_IDS=$ids\n");
        $configurationFailed = false;
        try { new Simulator(new Config($testConfig)); } catch (RuntimeException) { $configurationFailed = true; }
        check($configurationFailed, "lista invalida es error tecnico, no decision de pago: $ids");
    }
    foreach (['',str_repeat('a',151)] as $reason) {
        file_put_contents($testConfig, "PAYMENT_REJECTION_REASON=$reason\n");
        $configurationFailed = false;
        try { new Simulator(new Config($testConfig)); } catch (RuntimeException) { $configurationFailed = true; }
        check($configurationFailed, 'motivo invalido es error de configuracion');
    }
    file_put_contents($testConfig, "PAYMENT_REJECT_ORDER_IDS=2147483647\n");
    check((new Simulator(new Config($testConfig)))->decide(new Order(2147483647,26,'0.01'))['estado'] === 'RECHAZADO', 'ID maximo compatible con INT');
    file_put_contents($testConfig, "PAYMENT_MODE=rechazar\nPAYMENT_LIMIT=0.01\n");
    check((new Simulator(new Config($testConfig)))->decide($rejected)['estado'] === 'APROBADO', 'opciones retiradas no activan reglas antiguas');
    invalid(fn() => Order::fromJson('{'), 'JSON malformado');
    invalid(fn() => Order::fromJson(file_get_contents(dirname(__DIR__) . '/examples/pedido-invalido.json')), 'total negativo');
    foreach ([0, -1, 2147483648, '1001', 1.5, true, null] as $id) {
        invalid(fn() => Order::fromJson(json_encode(['evento'=>'PedidoCreado','pedidoId'=>$id,'clienteId'=>25,'total'=>10])), 'pedidoId invalido ' . json_encode($id));
    }
    invalid(fn() => Order::fromJson('{"evento":"Otro","pedidoId":1,"clienteId":2,"total":10}'), 'evento desconocido');
    $customEvent = '{"evento":"OrdenConfirmada","pedidoId":1,"clienteId":2,"total":10.25}';
    check(Order::fromJson($customEvent, 'OrdenConfirmada')->total === '10.25', 'nombre configurado conserva contrato e importe');
    invalid(fn() => Order::fromJson($customEvent), 'nombre personalizado rechazado por defecto');
    invalid(fn() => Order::fromJson(file_get_contents(dirname(__DIR__) . '/examples/pedido-aprobado.json'), 'OrdenConfirmada'), 'solo se acepta el nombre configurado');
    invalid(fn() => Order::fromJson('{"pedidoId":1,"clienteId":2,"total":10}', 'OrdenConfirmada'), 'nombre configurado no admite JSON arbitrario');
    invalid(fn() => Order::fromJson('{"evento":"OrdenConfirmada","pedidoId":1,"clienteId":2,"total":10.001}', 'OrdenConfirmada'), 'nombre personalizado conserva validacion monetaria');
    $previousEvent = getenv('AMQP_EVENT_INPUT');
    try {
        putenv('AMQP_EVENT_INPUT');
        file_put_contents($testConfig, '');
        check((new Config($testConfig))->inputEvent() === 'PedidoCreado', 'evento predeterminado compatible');
        file_put_contents($testConfig, "AMQP_EVENT_INPUT=OrdenConfirmada\n");
        check((new Config($testConfig))->inputEvent() === 'OrdenConfirmada', 'evento configurado desde archivo');
        putenv('AMQP_EVENT_INPUT=PedidoConfirmado');
        check((new Config($testConfig))->inputEvent() === 'PedidoConfirmado', 'entorno tiene prioridad sobre archivo');
        putenv('AMQP_EVENT_INPUT=');
        $configurationFailed = false;
        try { (new Config($testConfig))->inputEvent(); } catch (RuntimeException) { $configurationFailed = true; }
        check($configurationFailed, 'evento vacio es error de configuracion');
    } finally {
        $previousEvent === false ? putenv('AMQP_EVENT_INPUT') : putenv('AMQP_EVENT_INPUT=' . $previousEvent);
    }
    invalid(fn() => Order::fromJson('{"evento":"PedidoCreado","pedidoId":1,"total":10}'), 'cliente faltante');
    foreach ([0, -1, true, null, '1.001', '10000000000', 'NaN', '1e8', [], INF] as $amount) {
        invalid(fn() => Money::decimal($amount), 'valor invalido ' . get_debug_type($amount));
    }
    check(Money::decimal(5000000) === '5000000.00', 'contrato del profesor sin campos extra');
    check(Money::decimal('9999999999.99') === '9999999999.99', 'maximo DECIMAL(12,2)');
    check(Money::cents(Money::decimal('0.01')) === 1, 'precision de un centavo');
    $row = ['id'=>1,'pedido_id'=>1001,'cliente_id'=>25,'total'=>'5000000.00','estado'=>'APROBADO','motivo_rechazo'=>null,'fecha_procesamiento'=>'2026-10-04 15:30:00'];
    $event = PaymentEvent::fromRow($row);
    check($event === ['evento'=>'PagoAprobado','pedidoId'=>1001,'clienteId'=>25,'pagoId'=>1,'total'=>5000000.0,'estado'=>'APROBADO','fecha'=>'2026-10-04T15:30:00Z'], 'contrato de salida aprobado');
    $row['estado'] = 'RECHAZADO'; $row['motivo_rechazo'] = 'Rechazo de prueba';
    check(PaymentEvent::fromRow($row)['motivo'] === 'Rechazo de prueba' && PaymentEvent::fromRow($row)['evento'] === 'PagoRechazado', 'contrato de salida rechazado');
    check(PaymentEvent::fromRow($row) === PaymentEvent::fromRow($row), 'fecha y contenido estables al republicar');
    require __DIR__ . '/regressions.php';
    echo "$count comprobaciones correctas; sin acceso a base de datos ni RabbitMQ.\n";
} finally {
    unlink($testConfig);
    foreach ($simulationEnvironment as $key=>$value) { $value === false ? putenv($key) : putenv($key . '=' . $value); }
}
