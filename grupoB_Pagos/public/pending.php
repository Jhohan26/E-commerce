<?php
declare(strict_types=1);

use Pagos\Database;
use Pagos\PaymentRepository;

require_once __DIR__ . '/_auth.php';

requireAuth(['operador', 'administrador']);

session_write_close();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Allow: GET');

    echo json_encode([
        'error' => true,
        'message' => 'Method not allowed'
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);

    exit;
}

try {
    $config = require dirname(__DIR__) . '/bootstrap.php';

    $repository = new PaymentRepository(
        Database::connect($config)
    );

    echo json_encode(
        $repository->awaitingDecision(),
        JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE
    );
} catch (Throwable) {
    http_response_code(503);

    echo json_encode([
        'error' => true,
        'message' => 'No fue posible consultar los pagos pendientes'
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
}
