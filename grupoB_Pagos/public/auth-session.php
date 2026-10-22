<?php
declare(strict_types=1);

use Pagos\Auth\AuthException;
use Pagos\Auth\JwtAuth;
use Pagos\ClientRpc;

require_once __DIR__ . '/_auth.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    header('Content-Type: application/json; charset=utf-8');

    echo json_encode([
        'error' => true,
        'message' => 'Method not allowed'
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);

    exit;
}

$validateCsrf = static function (): void {
    if (
        !is_string($_POST['csrf'] ?? null)
        || !hash_equals(
            $_SESSION['payment_csrf'],
            $_POST['csrf']
        )
    ) {
        throw new AuthException(
            'Solicitud no autorizada.',
            403
        );
    }
};

try {
    $config = require dirname(__DIR__) . '/bootstrap.php';
    $auth = new JwtAuth($config);

    $token = bearerToken($_SERVER);

    if (
        $token === null
        && is_string($_POST['token'] ?? null)
        && trim($_POST['token']) !== ''
    ) {
        $token = trim($_POST['token']);
    }

    $credentialsLogin = false;

    if ($token === null) {
        $validateCsrf();

        $usuario = is_string($_POST['usuario'] ?? null)
            ? trim($_POST['usuario'])
            : '';

        $password = is_string($_POST['password'] ?? null)
            ? $_POST['password']
            : '';

        if ($usuario === '' || $password === '') {
            throw new AuthException(
                'Usuario y contraseña son obligatorios.',
                400
            );
        }

        try {
            $token = (new ClientRpc($config))->login(
                $usuario,
                $password
            );
        } catch (InvalidArgumentException) {
            throw new AuthException(
                'Usuario y contraseña son obligatorios.',
                400
            );
        } catch (RuntimeException $error) {
            if ($error->getMessage() === 'Clientes no disponible') {
                throw new AuthException(
                    'El servicio de autenticación no está disponible.',
                    503
                );
            }

            throw new AuthException(
                'Usuario o contraseña incorrectos.',
                401
            );
        }

        $credentialsLogin = true;
    }

    $user = $auth->authenticateToken($token);

    $auth->requireRoles(
        $user,
        ['operador', 'administrador']
    );

    if (!$credentialsLogin) {
        $validateCsrf();
    }

    session_regenerate_id(true);

    $_SESSION = [
        'payment_csrf' => bin2hex(random_bytes(32)),
        'auth_token' => $token
    ];

    $accept = strtolower(
        (string) ($_SERVER['HTTP_ACCEPT'] ?? '')
    );

    if (str_contains($accept, 'application/json')) {
        header('Content-Type: application/json; charset=utf-8');

        echo json_encode([
            'status' => 'ok',
            'user' => $user->id,
            'role' => $user->role
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);

        exit;
    }

    http_response_code(303);
    header('Location: ./');
    exit;

} catch (AuthException $error) {
    authError($error);
}