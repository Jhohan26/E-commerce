<?php
declare(strict_types=1);

require_once __DIR__ . '/_auth.php';

$user = requireAuth(['operador', 'administrador']);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    exit;
}
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

echo json_encode([
    'status' => 'ok',
    'service' => 'pagos',
    'user' => $user->id,
    'role' => $user->role
], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);