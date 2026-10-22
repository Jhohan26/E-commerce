<?php
declare(strict_types=1);

use Pagos\ClientRpc;
use Pagos\Database;
use Pagos\PaymentRepository;

require_once __DIR__ . '/_layout.php';
require_once __DIR__ . '/_auth.php';

requireAuth(['operador', 'administrador']);

// El RPC puede tardar; otras consultas de la misma sesión deben continuar.
session_write_close();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Allow: GET');

    echo json_encode([
        'status' => 'unavailable',
        'message' => 'Method not allowed'
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);

    exit;
}

try {
    $orderId = inputId($_GET['pedidoId'] ?? null);

    $config = require dirname(__DIR__) . '/bootstrap.php';

    $repository = new PaymentRepository(
        Database::connect($config)
    );

    $row = $repository->history($orderId)[0] ?? null;

    if ($row === null) {
        http_response_code(404);

        echo json_encode([
            'status' => 'not_found'
        ], JSON_THROW_ON_ERROR);

        exit;
    }

    $name = (new ClientRpc($config))->lookup(
        (int) $row['cliente_id']
    );

    echo json_encode([
        'status' => $name === null ? 'not_found' : 'ok',
        'name' => $name
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
} catch (InvalidArgumentException) {
    http_response_code(400);

    echo json_encode([
        'status' => 'unavailable'
    ], JSON_THROW_ON_ERROR);
} catch (Throwable) {
    http_response_code(503);

    echo json_encode([
        'status' => 'unavailable'
    ], JSON_THROW_ON_ERROR);
}
