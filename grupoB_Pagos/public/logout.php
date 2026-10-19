<?php
declare(strict_types=1);
require_once __DIR__ . '/_session.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    exit;
}
if (!is_string($_POST['csrf'] ?? null) || !hash_equals($_SESSION['payment_csrf'], $_POST['csrf'])) {
    http_response_code(403);
    exit('Solicitud no autorizada.');
}
$_SESSION = [];
$params = session_get_cookie_params();
setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $params['path'],
    'domain' => $params['domain'], 'secure' => $params['secure'],
    'httponly' => true, 'samesite' => 'Strict']);
session_destroy();
header('Location: login.php', true, 303);