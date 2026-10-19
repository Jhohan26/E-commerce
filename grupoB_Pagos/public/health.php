<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Allow: GET');

    echo json_encode([
        'status' => 'error',
        'message' => 'Method not allowed'
    ], JSON_THROW_ON_ERROR);

    exit;
}

http_response_code(200);

echo json_encode([
    'status' => 'ok',
    'service' => 'pagos'
], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);