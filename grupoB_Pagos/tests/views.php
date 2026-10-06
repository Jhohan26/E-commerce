<?php
declare(strict_types=1);
require dirname(__DIR__) . '/public/_layout.php';
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
$assert(str_contains($approvedHtml, '<dt>Cliente</dt>') && str_contains($approvedHtml, '#25'), 'cliente registrado visible en el resultado');
$assert(str_contains($approvedHtml, 'Publicación confirmada') && str_contains($approvedHtml, 'pedidoId=7001'), 'publicacion y consulta del mismo pedido');
$assert(str_contains($approvedHtml, 'data-final="1"'), 'resultado final detiene consultas');
$fixture['evento_publicado'] = 0;
$assert(str_contains($render($fixture), 'Pago aprobado.') && str_contains($render($fixture), 'Pendiente de publicación'), 'aprobacion independiente de publicacion');
$fixture['motivo_rechazo'] = 'Motivo que no corresponde';
$assert(!str_contains($render($fixture), 'Motivo que no corresponde'), 'motivo se muestra solo en rechazos');
$fixture['estado'] = 'RECHAZADO'; $fixture['motivo_rechazo'] = '<script>alert(1)</script>';
$rejectedHtml = $render($fixture);
$assert(str_contains($rejectedHtml, 'Pago rechazado.') && str_contains($rejectedHtml, '&lt;script&gt;'), 'rechazo y motivo escapado');
$assert(!str_contains($rejectedHtml, '<script>'), 'datos no ejecutan HTML');
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
        $assert(str_contains($html, 'Enviar pedido de prueba') === ($testEnabled === '1'), 'formulario respeta configuracion ' . $testEnabled);
    }
    $_SERVER['REQUEST_METHOD'] = 'POST';
    putenv('WEB_TEST_ENABLED=0');
    ob_start(); require dirname(__DIR__) . '/public/index.php'; $html = ob_get_clean();
    $assert(http_response_code() === 403 && str_contains($html, 'deshabilitada'), 'POST bloqueado cuando se deshabilita');
    http_response_code(200); putenv('WEB_TEST_ENABLED=1');
    $_POST = ['csrf'=>'invalido'];
    ob_start(); require dirname(__DIR__) . '/public/index.php'; $html = ob_get_clean();
    $assert(http_response_code() === 403 && str_contains($html, 'sesión'), 'POST requiere token de sesion');
    http_response_code(200);
    $_POST = ['csrf'=>$_SESSION['payment_csrf'],'pedidoId'=>'1','clienteId'=>'2','productoId'=>'3','cantidad'=>'1','total'=>'1.001','precio'=>'1'];
    ob_start(); require dirname(__DIR__) . '/public/index.php'; $html = ob_get_clean();
    $assert(http_response_code() === 400 && str_contains($html, '2 decimales'), 'importe invalido se rechaza antes de publicar');
} finally {
    $previousEnabled === false ? putenv('WEB_TEST_ENABLED') : putenv('WEB_TEST_ENABLED=' . $previousEnabled);
    $_GET = $previousGet; $_POST = $previousPost;
    if ($previousMethod === null) { unset($_SERVER['REQUEST_METHOD']); } else { $_SERVER['REQUEST_METHOD'] = $previousMethod; }
    http_response_code(200);
    if (session_status() === PHP_SESSION_ACTIVE) { session_write_close(); }
}
echo "$checks comprobaciones de presentacion; sin servicios reales.\n";
ob_end_flush();
