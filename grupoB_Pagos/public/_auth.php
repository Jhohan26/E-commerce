<?php
declare(strict_types=1);

use Pagos\Auth\AuthException;
use Pagos\Auth\AuthUser;
use Pagos\Auth\JwtAuth;

require_once __DIR__ . '/_session.php';

function authorizationHeader(array $server): string
{
    foreach (
        ['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION']
        as $key
    ) {
        $value = trim((string) ($server[$key] ?? ''));

        if ($value !== '') {
            return $value;
        }
    }

    return '';
}

function bearerToken(array $server): ?string
{
    $authorization = authorizationHeader($server);

    if (!preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches)) {
        return null;
    }

    $token = trim($matches[1]);

    return $token !== '' ? $token : null;
}

function authError(AuthException $error): never
{
    http_response_code($error->httpStatus);

    if ($error->httpStatus === 401) {
        unset($_SESSION['auth_token']);
        header('WWW-Authenticate: Bearer');
    }

    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');

    echo json_encode([
        'error' => true,
        'message' => $error->getMessage()
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);

    exit;
}

function requireAuth(array $roles = [], bool $allowSession = true): AuthUser
{
    try {
        $config = require dirname(__DIR__) . '/bootstrap.php';
        $auth = new JwtAuth($config);

        $authorization = authorizationHeader($_SERVER);
        $token = bearerToken($_SERVER);

        if (
            $token === null
            && $authorization === ''
            && $allowSession
            && is_string($_SESSION['auth_token'] ?? null)
            && $_SESSION['auth_token'] !== ''
        ) {
            $token = $_SESSION['auth_token'];
        }

        if ($token === null) {
            throw new AuthException('Token requerido', 401);
        }

        $user = $auth->authenticateToken($token);

        if ($roles !== []) {
            $auth->requireRoles($user, $roles);
        }

        return $user;
    } catch (AuthException $error) {
        authError($error);
    }
}