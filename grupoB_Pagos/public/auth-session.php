<?php
declare(strict_types=1);

use Pagos\Auth\AuthException;
use Pagos\Auth\JwtAuth;

require_once __DIR__ . '/_auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    header('Allow: POST');

    echo json_encode([
        'error' => true,
        'message' => 'Method not allowed'
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);

    exit;
}

try {
    $token = bearerToken($_SERVER);

    if ($token === null) {
        throw new AuthException('Token requerido', 401);
    }

    $config = require dirname(__DIR__) . '/bootstrap.php';
    $auth = new JwtAuth($config);

    $user = $auth->authenticateToken($token);

    $auth->requireRoles(
        $user,
        ['operador', 'administrador']
    );

    if (!is_string($_POST['csrf'] ?? null) || !hash_equals($_SESSION['payment_csrf'], $_POST['csrf'])) {
        throw new AuthException('Solicitud no autorizada.', 403);
    }
    session_regenerate_id(true);
    $_SESSION = ['payment_csrf' => bin2hex(random_bytes(32))];

    $_SESSION['auth_token'] = $token;

    echo json_encode([
        'status' => 'ok',
        'user' => $user->id,
        'role' => $user->role
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
} catch (AuthException $error) {
    authError($error);
}