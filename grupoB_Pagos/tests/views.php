<?php
declare(strict_types=1);
require dirname(__DIR__) . '/public/_layout.php';
require dirname(__DIR__) . '/bootstrap.php';
putenv('JWT_ALGORITHM=HS256');
putenv('JWT_SECRET=' . str_repeat('v', 64));
putenv('JWT_ISSUER=views-test');
putenv('JWT_USER_CLAIM=sub');
putenv('JWT_ROLE_CLAIM=role');
$viewToken = Firebase\JWT\JWT::encode(['iss'=>'views-test','sub'=>'views','role'=>'operador','exp'=>time()+300], str_repeat('v', 64), 'HS256');
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $viewToken;
ob_start();
$checks = 0;
$render = static function (?array $row, string $query = '', ?string $error = null): string {
    ob_start(); require dirname(__DIR__) . '/public/_result.php'; return ob_get_clean();
};
$assert = static function (bool $valid, string $label) use (&$checks): void {
    if (!$valid) { throw new RuntimeException('FALLO: ' . $label); }
    echo "OK $label\n"; $checks++;
};
$fixture = ['id'=>91,'pedido_id'=>7001,'cliente_id'=>25,'total'=>'120000.50','estado'=>'APROBADO','motivo_rechazo'=>null,'fecha_procesamiento'=>'2026-10-04 15:30:00','evento_publicado'=>1];
$approvedHtml = $render($fixture);
$assert(str_contains($approvedHtml, 'Pago aprobado.') && str_contains($approvedHtml, '120.000,50'), 'resultado aprobado e importe registrado');
$assert(str_contains($approvedHtml, '<dt>Cliente ID</dt>') && str_contains($approvedHtml, '#25'), 'cliente registrado visible en el resultado');
$assert(str_contains($approvedHtml, 'Publicación confirmada') && str_contains($approvedHtml, 'pedidoId=7001'), 'publicacion y consulta del mismo pedido');
$assert(str_contains($approvedHtml, 'data-final="1"'), 'resultado final detiene consultas');
$assert(!str_contains($approvedHtml, 'Actualizar resultado'), 'sin boton de actualizacion redundante');
$fixture['evento_publicado'] = 0;
$assert(str_contains($render($fixture), 'data-published="0"'), 'publicacion pendiente permite consulta automatica');
$assert(str_contains($render($fixture), 'Pago aprobado.') && str_contains($render($fixture), 'Pendiente de publicación'), 'aprobacion independiente de publicacion');
$fixture['motivo_rechazo'] = 'Motivo que no corresponde';
$assert(!str_contains($render($fixture), 'Motivo que no corresponde'), 'motivo se muestra solo en rechazos');
$fixture['estado'] = 'RECHAZADO'; $fixture['motivo_rechazo'] = '<script>alert(1)</script>';
$rejectedHtml = $render($fixture);
$assert(str_contains($rejectedHtml, 'Pago rechazado.') && str_contains($rejectedHtml, '&lt;script&gt;'), 'rechazo y motivo escapado');
$assert(!str_contains($rejectedHtml, '<script>'), 'datos no ejecutan HTML');
$assert(!str_contains($rejectedHtml, 'action="decide.php"'), 'pago final no permite decidir de nuevo');
$fixture['estado'] = 'PENDIENTE';
$_SESSION['payment_csrf'] = 'token-de-prueba';
$pendingHtml = $render($fixture);
$assert(str_contains($pendingHtml, '>Pagar</button>') && str_contains($pendingHtml, '>Rechazar</button>'), 'pedido pendiente ofrece ambas decisiones');
$assert(str_contains($pendingHtml, 'method="post" action="decide.php"') && str_contains($pendingHtml, 'value="token-de-prueba"'), 'decision enviada por POST con CSRF');
$assert(str_contains($pendingHtml, 'Esperando decisión') && !str_contains($pendingHtml, 'Pendiente de publicación'), 'pendiente manual no se confunde con fallo del broker');
$assert(str_contains($pendingHtml, 'data-awaiting-decision="1"'), 'consulta automatica no reemplaza el formulario mientras se escribe');
$assert(str_contains($render(null, '7002'), 'Esperando resultado') && str_contains($render(null, '7002'), 'data-final="0"'), 'pedido sin fila permanece pendiente');
$assert(str_contains($render(null), 'Ingresa un pedido'), 'inicio sin datos inventados');
$assert(str_contains($render(null, '', 'Conexion no disponible'), 'role="alert"'), 'error tecnico accesible');
$previousEnabled = getenv('WEB_TEST_ENABLED');
$previousGet = $_GET; $previousPost = $_POST; $previousMethod = $_SERVER['REQUEST_METHOD'] ?? null;
session_set_save_handler(new class implements SessionHandlerInterface {
    private array $data = [];
    public function open(string $path, string $name): bool { return true; }
    public function close(): bool { return true; }
    public function read(string $id): string|false { return $this->data[$id] ?? ''; }
    public function write(string $id, string $data): bool { $this->data[$id] = $data; return true; }
    public function destroy(string $id): bool { unset($this->data[$id]); return true; }
    public function gc(int $maxLifetime): int|false { return 0; }
}, true);
try {
    $_GET = []; $_POST = []; $_SERVER['REQUEST_METHOD'] = 'GET';
    foreach (['0', '1'] as $testEnabled) {
        putenv('WEB_TEST_ENABLED=' . $testEnabled);
        ob_start(); require dirname(__DIR__) . '/public/index.php'; $html = ob_get_clean();
        $assert(str_contains($html, '>Pago</a>') && str_contains($html, '>Historial</a>') && !str_contains($html, 'Resultado real'), 'solo dos vistas ' . $testEnabled);
        $assert(!str_contains($html, '<footer') && !str_contains($html, '<svg') && !str_contains($html, 'Grupo B') && !str_contains($html, 'type="radio"'), 'interfaz sin catalogo ni selector ' . $testEnabled);
        $assert(!str_contains($html, 'Enviar pedido de prueba'), 'formulario de prueba retirado con configuracion ' . $testEnabled);
    }
    $_SERVER['REQUEST_METHOD'] = 'POST';
    putenv('WEB_TEST_ENABLED=0');
    ob_start(); require dirname(__DIR__) . '/public/index.php'; $html = ob_get_clean();
    $assert(http_response_code() === 405 && str_contains($html, 'solo permite consultar'), 'POST antiguo no publica pedidos');
    http_response_code(200); putenv('WEB_TEST_ENABLED=0');
    $_POST = ['csrf'=>'invalido', 'pedidoId'=>'1', 'estado'=>'APROBADO'];
    ob_start(); require dirname(__DIR__) . '/public/decide.php'; $html = ob_get_clean();
    $assert(http_response_code() === 403 && str_contains($html, 'sesión'), 'decision manual rechaza CSRF invalido aunque prueba web este deshabilitada');
    http_response_code(200);
    $_POST = ['csrf'=>$_SESSION['payment_csrf'], 'pedidoId'=>'1', 'estado'=>['APROBADO']];
    ob_start(); require dirname(__DIR__) . '/public/decide.php'; $html = ob_get_clean();
    $assert(http_response_code() === 400 && str_contains($html, 'Decisión inválida'), 'decision manual valida peticion antes de acceder a servicios');
} finally {
    $previousEnabled === false ? putenv('WEB_TEST_ENABLED') : putenv('WEB_TEST_ENABLED=' . $previousEnabled);
    $_GET = $previousGet; $_POST = $previousPost;
    if ($previousMethod === null) { unset($_SERVER['REQUEST_METHOD']); } else { $_SERVER['REQUEST_METHOD'] = $previousMethod; }
    http_response_code(200);
    if (session_status() === PHP_SESSION_ACTIVE) { session_write_close(); }
}
echo "$checks comprobaciones de presentacion; sin servicios reales.\n";
ob_end_flush();
