<?php
declare(strict_types=1);
use Firebase\JWT\JWT;
require dirname(__DIR__) . '/bootstrap.php';
$root = dirname(__DIR__);
$temp = sys_get_temp_dir() . '/pagos-auth-' . bin2hex(random_bytes(8));
mkdir($temp);
$socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
if (!$socket) { throw new RuntimeException('No se pudo reservar puerto local'); }
$address = stream_socket_get_name($socket, false);
fclose($socket);
$secret = bin2hex(random_bytes(32));
$env = array_replace(getenv(), ['JWT_SECRET'=>$secret,'JWT_ALGORITHM'=>'HS256','JWT_ISSUER'=>'web-test','JWT_USER_CLAIM'=>'sub','JWT_ROLE_CLAIM'=>'role','JWT_CLIENT_CLAIM'=>'clienteId','DB_HOST'=>'invalid;blocked','RABBITMQ_URL'=>'invalid://blocked']);
$process = proc_open([PHP_BINARY,'-d','session.save_path='.$temp,'-S',$address,'-t',$root.'/public'], [0=>['pipe','r'],1=>['file',$temp.'/server.log','a'],2=>['file',$temp.'/server.log','a']], $pipes, $root, $env);
if (!is_resource($process)) { throw new RuntimeException('No se pudo iniciar PHP local'); }
$checks = 0;
$check = function (bool $ok, string $label) use (&$checks): void {
    if (!$ok) { throw new RuntimeException("FALLO: $label"); }
    $checks++; echo "OK $label\n";
};
$cookie = '';
$request = function (string $path, string $method='GET', ?string $token=null, array $data=[]) use ($address, &$cookie): array {
    $headers = ['Accept: application/json'];
    if ($cookie !== '') { $headers[] = 'Cookie: '.$cookie; }
    if ($token !== null) { $headers[] = 'Authorization: Bearer '.$token; }
    if ($method === 'POST') { $headers[] = 'Content-Type: application/x-www-form-urlencoded'; }
    $context = stream_context_create(['http'=>['method'=>$method,'header'=>implode("\r\n",$headers),'content'=>http_build_query($data),'ignore_errors'=>true,'follow_location'=>0,'timeout'=>5]]);
    $body = file_get_contents('http://'.$address.'/'.$path, false, $context);
    $response = $http_response_header ?? [];
    preg_match('/\s(\d{3})\s/', $response[0] ?? '', $status);
    foreach ($response as $header) {
        if (preg_match('/^Set-Cookie:\s*(PHPSESSID=[^;]*)/i',$header,$match)) { $cookie=$match[1]; }
    }
    return [(int)($status[1] ?? 0),$body,$response];
};
$make = fn(string $role, int $expiry): string => JWT::encode(['iss'=>'web-test','sub'=>'web-user','role'=>$role,'exp'=>$expiry],$secret,'HS256');
try {
    $ready=false;
    for ($i=0;$i<50;$i++) {
        $connection=@stream_socket_client('tcp://'.$address,$errno,$error,0.1);
        if ($connection) { fclose($connection); $ready=true; break; }
        usleep(100000);
    }
    $check($ready,'servidor HTTP aislado');
    $check($request('health.php')[0]===200,'health publico');
    $readyResponse=$request('ready.php');
    $check($readyResponse[0]===503 && !str_contains($readyResponse[1], 'SQLSTATE'),'readiness separada sin detalles internos');
    $check($request('health.php','POST')[0]===405,'health metodo incorrecto');
    foreach (['index.php','pending.php','client.php','history.php','decide.php','secure-test.php'] as $path) {
        $check($request($path)[0]===401,"$path sin token");
        $check($request($path,'GET',$make('cliente',time()+300))[0]===403,"$path bloquea cliente");
    }
    $check($request('secure-test.php','GET',$make('operador',time()+300))[0]===200,'Bearer operador');
    $check($request('secure-test.php','GET',$make('administrador',time()+300))[0]===200,'Bearer administrador');
    $check($request('secure-test.php','GET',$make('operador',time()-5))[0]===401,'Bearer vencido');
    $cookie = '';
    $login = $request('login.php');
    preg_match('/name="csrf" value="([^"]+)"/',$login[1],$match);
    $csrf=$match[1] ?? '';
    $check($csrf!=='' && str_contains(implode(' ',$login[2]),'HttpOnly'),'login CSRF y cookie HttpOnly');
    $check(str_contains(strtolower(implode(' ',$login[2])),'samesite=strict'),'cookie SameSite Strict');
    $check(str_contains(implode(' ',$login[2]),"script-src 'self'"),'CSP conservada');
    $before=$cookie;
    $check($request('auth-session.php','POST',$make('operador',time()+300),['csrf'=>'incorrecto'])[0]===403,'login bloquea CSRF');
    $check($request('auth-session.php','POST',$make('operador',time()+300),['csrf'=>$csrf])[0]===200,'autenticacion de sesion');
    $check($cookie!==$before,'regenera ID contra fixation');
    $check($request('secure-test.php')[0]===200,'sesion sin reenviar JWT');
    $check($request('pending.php','POST')[0]===405,'pending conserva autenticacion por sesion');
    $check($request('client.php','POST')[0]===405,'client conserva autenticacion por sesion');
    $check($request('history.php?pedidoId=incorrecto')[0]===400,'history acepta sesion y valida entrada');
    $check($request('decide.php','POST',null,['csrf'=>'incorrecto'])[0]===403,'decide bloquea CSRF antes de servicios');
    $check($request('logout.php')[0]===405,'logout requiere POST');
    $check($request('logout.php','POST',null,['csrf'=>'incorrecto'])[0]===403,'logout bloquea CSRF');
    $login=$request('login.php');
    preg_match('/name="csrf" value="([^"]+)"/',$login[1],$match);
    $sessionCookie=$cookie;
    $check($request('logout.php','POST',null,['csrf'=>$match[1]])[0]===303,'logout redirige al login');
    $cookie=$sessionCookie;
    $check($request('secure-test.php')[0]===401,'logout destruye sesion anterior');
    $login=$request('login.php');
    preg_match('/name="csrf" value="([^"]+)"/',$login[1],$match);
    $check($request('auth-session.php','POST',$make('operador',time()+300),['csrf'=>$match[1]])[0]===200,'nueva sesion para revalidacion');
    $id=substr($cookie,strlen('PHPSESSID='));
    $sessionFile=$temp.'/sess_'.$id;
    $data=file_get_contents($sessionFile);
    $data=preg_replace('/auth_token\|s:\d+:"[^"]*";/', 'auth_token|s:'.strlen($expired=$make('operador',time()-30)).':"'.$expired.'";',$data);
    file_put_contents($sessionFile,$data);
    $check($request('secure-test.php')[0]===401,'JWT vencido en sesion se revalida');
    $check(!str_contains(file_get_contents($temp.'/server.log'),$secret),'logs sin clave');
    echo "$checks comprobaciones HTTP; sin MySQL ni RabbitMQ reales.\n";
} finally {
    proc_terminate($process);
    fclose($pipes[0]);
    proc_close($process);
    foreach (glob($temp.'/*') as $file) { unlink($file); }
    rmdir($temp);
}
