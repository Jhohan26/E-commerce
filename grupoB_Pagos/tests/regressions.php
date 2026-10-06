<?php
declare(strict_types=1);

use Pagos\{Order, Money, PendingRecovery, PublicationException};

$jsonAmount = static fn(string $literal): string => '{"evento":"PedidoCreado","pedidoId":1,"clienteId":2,"total":' . $literal . '}';
foreach (['5000000.00000001', '0.10000000000000001', '9999999999.999', '1.001', '1.230', '1e-3', '1e999', '-0.01', 'true', 'null', '{}', '[]'] as $literal) {
    invalid(fn() => Order::fromJson($jsonAmount($literal)), "rechazo exacto del lexema $literal");
}
foreach (['5000000' => '5000000.00', '9999999999.99' => '9999999999.99', '0.01' => '0.01', '1.20' => '1.20', '5e6' => '5000000.00', '123e-2' => '1.23', '1.23e2' => '123.00', '1e0000' => '1.00', '"1.20"' => '1.20'] as $literal => $expected) {
    check(Order::fromJson($jsonAmount((string) $literal))->total === $expected, "decimal exacto $literal");
}
invalid(fn() => Money::decimal(0.1), 'no aceptar floats ya convertidos en Money');
check(Order::fromJson('{"productos":[{"total":99.999}],"evento":"PedidoCreado","pedidoId":1,"clienteId":2,"total":1.25}')->total === '1.25', 'ignorar total anidado');
check(Order::fromJson('{"evento":"PedidoCreado","pedidoId":1,"clienteId":2,"texto":"total: 0.001","t\u006ftal":2.25}')->total === '2.25', 'clave JSON escapada y texto no monetario');
check(Order::fromJson('{"evento":"PedidoCreado","pedidoId":1,"clienteId":2,"total":0.001,"total":3.25}')->total === '3.25', 'ultima clave coincide con json_decode');
invalid(fn() => Order::fromJson('{"evento":"PedidoCreado","pedidoId":1,"clienteId":2,"total":3.25,"total":0.001}'), 'ultima clave invalida no se oculta');
$boundaryOrder = Order::fromJson($jsonAmount('5000000.01'));
check($boundaryOrder->total === '5000000.01' && $simulator->decide($boundaryOrder)['estado'] === 'APROBADO', 'decimal exacto aprobado sin umbral de decision');

$pendingRows = [1 => false, 2 => false, 3 => false, 4 => false];
$errors = []; $attempts = [];
$list = static function (int $limit, int $afterId) use (&$pendingRows): array {
    return array_slice(array_values(array_filter(array_keys($pendingRows), static fn(int $id): bool => $id > $afterId && !$pendingRows[$id])), 0, $limit);
};
$publish = static function (int $id) use (&$pendingRows, &$attempts): bool {
    $attempts[] = $id;
    if ($id === 1) { throw new PublicationException('Sin destino de prueba'); }
    $pendingRows[$id] = true;
    return true;
};
$onError = static function (int $id, Throwable $error) use (&$errors): void { $errors[] = $id; };
$recovery = new PendingRecovery();
$first = $recovery->run(2, $list, $publish, $onError, static fn(): bool => true);
check($first === ['published' => 1, 'failed' => 1] && $errors === [1], 'aislar fallo y publicar siguiente del mismo lote');
check(!$pendingRows[1] && $pendingRows[2], 'fallido sigue pendiente y exitoso publicado');
$second = $recovery->run(2, $list, $publish, $onError, static fn(): bool => true);
check($second['published'] === 2 && $attempts === [1, 2, 3, 4], 'cursor alcanza pagos posteriores aunque el primero falle');
$third = $recovery->run(2, $list, $publish, $onError, static fn(): bool => true);
check($third['failed'] === 1 && end($attempts) === 1, 'cursor vuelve a reintentar pendientes anteriores');
$pendingRows[1] = true;
check($recovery->run(2, $list, $publish, $onError, static fn(): bool => true) === ['published' => 0, 'failed' => 0], 'no republicar filas confirmadas');
$brokenRow = (new PendingRecovery())->run(2, static fn(): array => [5, 6], static function (int $id): bool {
    if ($id === 5) { throw new RuntimeException('Estado persistido invalido'); }
    return true;
}, $onError, static fn(): bool => true);
check($brokenRow === ['published' => 1, 'failed' => 1], 'fila invalida no impide recuperar la siguiente');
foreach ([new PDOException('Base no disponible'), new RuntimeException('Canal no disponible')] as $index => $failure) {
    $fatalWasRaised = false;
    try {
        (new PendingRecovery())->run(2, static fn(): array => [7, 8], static function () use ($failure): bool { throw $failure; }, $onError, static fn(): bool => $index === 0);
    } catch (Throwable $error) { $fatalWasRaised = $error === $failure; }
    check($fatalWasRaised, 'propagar fallo sistemico ' . $index);
}
