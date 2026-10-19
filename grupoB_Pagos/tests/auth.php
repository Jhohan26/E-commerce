<?php
declare(strict_types=1);
use Firebase\JWT\JWT;
use Pagos\Auth\AuthException;
use Pagos\Auth\JwtAuth;
$config = require dirname(__DIR__) . '/bootstrap.php';
$secret = bin2hex(random_bytes(32));
foreach (['JWT_ALGORITHM'=>'HS256','JWT_SECRET'=>$secret,'JWT_ISSUER'=>'auth-test','JWT_USER_CLAIM'=>'identity','JWT_ROLE_CLAIM'=>'permission','JWT_CLIENT_CLAIM'=>'customer'] as $key=>$value) { putenv("$key=$value"); }
$auth = new JwtAuth($config);
$checks = 0;
$check = function (bool $ok, string $label) use (&$checks): void {
    if (!$ok) { throw new RuntimeException("FALLO: $label"); }
    $checks++;
    echo "OK $label\n";
};
$base = ['iss'=>'auth-test','identity'=>'test-user','permission'=>'operador','customer'=>25,'exp'=>time()+300];
$token = fn(array $claims): string => JWT::encode($claims, $secret, 'HS256');
$reject = function (callable $operation, int $status, string $label) use ($check): void {
    try { $operation(); } catch (AuthException $e) { $check($e->httpStatus === $status, $label); return; }
    $check(false, $label);
};
foreach (['operador','administrador'] as $role) {
    $user = $auth->authenticateToken($token(array_replace($base,['permission'=>$role])));
    $auth->requireRoles($user,['operador','administrador']);
    $check($user->id === 'test-user' && $user->clientId === 25 && $user->role === $role, "identidad y rol $role");
}
$client = $auth->authenticateToken($token(array_replace($base,['permission'=>'cliente'])));
$reject(fn()=>$auth->requireRoles($client,['operador','administrador']),403,'cliente bloqueado');
$reject(fn()=>$auth->authenticate([]),401,'sin token');
$reject(fn()=>$auth->authenticateToken($token(array_replace($base,['exp'=>time()-30]))),401,'token vencido');
$reject(fn()=>$auth->authenticateToken($token(array_replace($base,['iss'=>'incorrecto']))),401,'issuer incorrecto');
$noExp = $base; unset($noExp['exp']);
$reject(fn()=>$auth->authenticateToken($token($noExp)),401,'expiracion obligatoria');
$altered = JWT::encode($base, bin2hex(random_bytes(32)), 'HS256');
$reject(fn()=>$auth->authenticateToken($altered),401,'firma alterada');
$reject(fn()=>$auth->authenticateToken($token(array_replace($base,['customer'=>[]]))),401,'cliente malformado');
echo "$checks comprobaciones JWT; claves efimeras sin servicios reales.\n";
