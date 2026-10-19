<?php
declare(strict_types=1);
use Pagos\ClientRpc;
require dirname(__DIR__) . '/bootstrap.php';
$count = 0;
function verifyClient(bool $ok, string $label): void {
    global $count;
    if (!$ok) { throw new RuntimeException('FALLO: ' . $label); }
    $count++; echo "OK $label\n";
}
$data = ['id'=>25, 'primer_nombre'=>' Ana ', 'segundo_nombre'=>null, 'primer_apellido'=>'Ortiz', 'segundo_apellido'=>''];
verifyClient(ClientRpc::nameFromResponse(['status'=>200, 'data'=>$data], 25) === 'Ana Ortiz', 'nombre sin partes vacias');
$data['segundo_nombre'] = 'Maria'; $data['segundo_apellido'] = 'Perez';
verifyClient(ClientRpc::nameFromResponse(['status'=>200, 'data'=>$data], 25) === 'Ana Maria Ortiz Perez', 'cuatro partes del nombre');
verifyClient(ClientRpc::nameFromResponse(['status'=>200, 'data'=>['id'=>'25','nombre'=>'Ana Ortiz']], 25) === 'Ana Ortiz', 'nombre simple e ID numerico en texto');
verifyClient(ClientRpc::nameFromResponse(['status'=>404], 25) === null, 'cliente inexistente');
foreach ([['status'=>500], ['status'=>200,'data'=>['id'=>26,'nombre'=>'Otro']], ['status'=>200,'data'=>['id'=>25]], ['status'=>200,'data'=>['id'=>25,'primer_nombre'=>[]]]] as $response) {
    $failed = false;
    try { ClientRpc::nameFromResponse($response, 25); } catch (RuntimeException) { $failed = true; }
    verifyClient($failed, 'respuesta incorrecta no muestra un nombre erroneo');
}
echo "$count comprobaciones de Clientes; sin servicios reales.\n";
