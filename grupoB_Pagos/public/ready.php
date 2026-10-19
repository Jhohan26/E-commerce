<?php
declare(strict_types=1);
use Pagos\Database;
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    exit;
}
try {
    $config = require dirname(__DIR__) . '/bootstrap.php';
    Database::connect($config)->query('SELECT 1');
    echo json_encode(['status'=>'ready','service'=>'pagos'], JSON_THROW_ON_ERROR);
} catch (Throwable) {
    http_response_code(503);
    echo json_encode(['status'=>'unavailable','service'=>'pagos'], JSON_THROW_ON_ERROR);
}
