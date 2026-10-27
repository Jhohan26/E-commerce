<?php
declare(strict_types=1);

// Herramienta CLI de laboratorio. Nunca es un endpoint HTTP.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$config = require dirname(__DIR__) . '/bootstrap.php';
$role = $argv[1] ?? 'operador';
if (!in_array($role, ['operador', 'administrador', 'cliente'], true)) {
    fwrite(STDERR, "Uso: php bin/lab-token.php operador|administrador|cliente [--expired]\n");
    exit(1);
}
$now = time();
$claims = [
    'iat' => $now - 120,
    'exp' => in_array('--expired', $argv, true) ? $now - 60 : $now + 3600,
    $config->get('JWT_USER_CLAIM', 'sub') => $role . '-laboratorio',
    $config->get('JWT_ROLE_CLAIM', 'role') => $role,
];
$issuer = $config->get('JWT_ISSUER', '');
if ($issuer !== '') { $claims['iss'] = $issuer; }
$secret = $config->get('JWT_SECRET', '');
if (strlen($secret) < 32) {
    fwrite(STDERR, "Configura JWT_SECRET con al menos 32 caracteres.\n");
    exit(1);
}
fwrite(STDERR, "Token de laboratorio; no guardar ni compartir. Vigencia normal: una hora.\n");
echo Firebase\JWT\JWT::encode($claims, $secret, 'HS256') . PHP_EOL;
