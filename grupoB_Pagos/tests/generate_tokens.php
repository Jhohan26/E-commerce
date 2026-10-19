<?php
declare(strict_types=1);

use Firebase\JWT\JWT;

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
fwrite(STDERR, "Solo desarrollo local. Tokens temporales; no guardar en archivos versionados.\n");
$config = require dirname(__DIR__) . '/bootstrap.php';

$secret = $config->get('JWT_SECRET');
$algorithm = $config->get('JWT_ALGORITHM', 'HS256');
$issuer = $config->get('JWT_ISSUER', 'ecommerce-auth');

$userClaim = $config->get('JWT_USER_CLAIM', 'sub');
$roleClaim = $config->get('JWT_ROLE_CLAIM', 'role');
$clientClaim = $config->get('JWT_CLIENT_CLAIM', 'clienteId');

function tokenFor(
    string $role,
    string $secret,
    string $algorithm,
    string $issuer,
    string $userClaim,
    string $roleClaim,
    string $clientClaim
): string {
    $now = time();

    return JWT::encode([
        'iss' => $issuer,
        'iat' => $now,
        'exp' => $now + 3600,
        $userClaim => $role . '-prueba',
        $roleClaim => $role,
        $clientClaim => 25
    ], $secret, $algorithm);
}

echo "CLIENTE=" . tokenFor(
    'cliente',
    $secret,
    $algorithm,
    $issuer,
    $userClaim,
    $roleClaim,
    $clientClaim
) . PHP_EOL;

echo "OPERADOR=" . tokenFor(
    'operador',
    $secret,
    $algorithm,
    $issuer,
    $userClaim,
    $roleClaim,
    $clientClaim
) . PHP_EOL;

echo "ADMINISTRADOR=" . tokenFor(
    'administrador',
    $secret,
    $algorithm,
    $issuer,
    $userClaim,
    $roleClaim,
    $clientClaim
) . PHP_EOL;