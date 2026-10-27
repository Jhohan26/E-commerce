<?php
declare(strict_types=1);
require dirname(__DIR__) . '/bootstrap.php';
$secret = bin2hex(random_bytes(32));
foreach (['JWT_SECRET'=>$secret, 'JWT_ISSUER'=>'test-lab', 'JWT_USER_CLAIM'=>'sub', 'JWT_ROLE_CLAIM'=>'role'] as $key=>$value) {
    putenv($key . '=' . $value);
}
$run = static function (array $arguments): array {
    $process = proc_open([PHP_BINARY, dirname(__DIR__) . '/bin/lab-token.php', ...$arguments],
        [0=>['pipe','r'], 1=>['pipe','w'], 2=>['pipe','w']], $pipes);
    if (!is_resource($process)) { throw new RuntimeException('No se pudo iniciar el helper'); }
    fclose($pipes[0]);
    $output = stream_get_contents($pipes[1]); fclose($pipes[1]);
    $error = stream_get_contents($pipes[2]); fclose($pipes[2]);
    return [proc_close($process), trim($output), $error];
};
foreach (['operador', 'administrador', 'cliente'] as $role) {
    [$status, $token] = $run([$role]);
    // La instalacion XAMPP puede avisar de openssl duplicado en stdout.
    preg_match('/eyJ[\w-]+\.[\w-]+\.[\w-]+/', $token, $matches);
    $claims = Firebase\JWT\JWT::decode($matches[0] ?? '', new Firebase\JWT\Key($secret, 'HS256'));
    if ($status !== 0 || $claims->role !== $role || $claims->iss !== 'test-lab' || abs($claims->exp - time() - 3600) > 5) {
        throw new RuntimeException('Token de laboratorio incorrecto');
    }
    echo "OK token firmado de $role con emisor y expiracion\n";
}
[$status, $token] = $run(['operador', '--expired']);
preg_match('/eyJ[\w-]+\.[\w-]+\.[\w-]+/', $token, $matches);
try {
    Firebase\JWT\JWT::decode($matches[0] ?? '', new Firebase\JWT\Key($secret, 'HS256'));
    throw new RuntimeException('El token de expiracion fue aceptado');
} catch (Firebase\JWT\ExpiredException) { echo "OK token de prueba vencido\n"; }
if ($run(['rol-desconocido'])[0] !== 1) { throw new RuntimeException('Se acepto un rol desconocido'); }
echo "OK rol desconocido rechazado\n";
putenv('JWT_SECRET=');
if ($run(['operador'])[0] !== 1) { throw new RuntimeException('Se firmo sin clave'); }
echo "OK firma sin clave rechazada; sin claves reales ni servicios externos\n";
