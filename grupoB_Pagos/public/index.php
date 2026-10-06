<?php
declare(strict_types=1);
use Pagos\{Broker, Database, Money, Order, PaymentRepository};
require_once __DIR__ . '/_layout.php';
$row = null; $error = null; $query = ''; $enabled = false; $config = null;
try {
    $config = require dirname(__DIR__) . '/bootstrap.php';
    $enabled = $config->get('WEB_TEST_ENABLED', '0') === '1';
    $rawQuery = $_GET['pedidoId'] ?? $_GET['pedido'] ?? '';
    if ($rawQuery !== '') { $query = (string) inputId($rawQuery); }
    if ($query !== '') { $row = (new PaymentRepository(Database::connect($config)))->history((int) $query)[0] ?? null; }
} catch (InvalidArgumentException $exception) { http_response_code(400); $error = $exception->getMessage(); }
catch (Throwable) { http_response_code(503); $error = 'No fue posible consultar el pago. Intenta de nuevo más adelante.'; }
if (($_GET['format'] ?? '') === 'json' && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    ob_start(); require __DIR__ . '/_result.php'; $html = ob_get_clean();
    echo json_encode(['html'=>$html,'final'=>$row !== null && in_array($row['estado'], ['APROBADO','RECHAZADO'], true),'error'=>$error !== null], JSON_THROW_ON_ERROR);
    exit;
}
if ($enabled) {
    if (session_status() !== PHP_SESSION_ACTIVE) { session_start(['cookie_httponly'=>true,'cookie_samesite'=>'Strict','cookie_secure'=>!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off']); }
    $_SESSION['payment_csrf'] ??= bin2hex(random_bytes(32));
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $broker = null;
    try {
        if (!$enabled) { http_response_code(403); throw new InvalidArgumentException('La prueba local de integración está deshabilitada.'); }
        if (!is_string($_POST['csrf'] ?? null) || !hash_equals($_SESSION['payment_csrf'], $_POST['csrf'])) { http_response_code(403); throw new InvalidArgumentException('La sesión del formulario expiró. Recarga la página.'); }
        $orderId = inputId($_POST['pedidoId'] ?? null);
        $clientId = inputId($_POST['clienteId'] ?? null);
        $productId = inputId($_POST['productoId'] ?? null);
        $quantity = inputId($_POST['cantidad'] ?? null);
        $total = Money::decimal($_POST['total'] ?? null);
        $price = Money::decimal($_POST['precio'] ?? null);
        $body = '{"evento":' . json_encode($config->inputEvent(), JSON_THROW_ON_ERROR) . ',"pedidoId":' . $orderId . ',"clienteId":' . $clientId . ',"fecha":' . json_encode(gmdate('Y-m-d\TH:i:s\Z')) . ',"total":' . $total . ',"productos":[{"productoId":' . $productId . ',"cantidad":' . $quantity . ',"precio":' . $price . '}]}';
        Order::fromJson($body, $config->inputEvent());
        $broker = new Broker($config);
        $broker->setup();
        $broker->publishRaw($body, $config->get('AMQP_KEY_INPUT', 'pedido.creado'));
        $broker->close(); $broker = null;
        header('Location: ./?pedidoId=' . $orderId, true, 303);
        exit;
    } catch (InvalidArgumentException $exception) { if (http_response_code() < 400) { http_response_code(400); } $error = $exception->getMessage(); }
    catch (Throwable) { http_response_code(503); $error = 'No se pudo confirmar el envío a RabbitMQ. Consulta el pedido antes de reintentar con el mismo identificador.'; }
    finally { if ($broker !== null) { try { $broker->close(); } catch (Throwable) {} } }
}
pageStart('payment', 'Pago');
?>
<section class="page-heading"><h1>Pago</h1><p>Consulta el estado y los detalles de tu pago.</p></section>
<div class="payment-grid"><div class="payment-sidebar"><section class="card lookup-card"><div class="card-heading"><h2>Consultar pedido</h2><p>Ingresa el identificador de tu pedido.</p></div><form method="get" class="lookup-form"><label for="lookup-order">Pedido ID</label><input id="lookup-order" name="pedidoId" type="number" min="1" max="2147483647" value="<?= h($query) ?>" required placeholder="Número de pedido"><button type="submit" class="button full-width">Consultar pago <span aria-hidden="true">→</span></button></form></section>
<?php if ($enabled): ?>
<section class="card integration"><details<?= ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST' ? ' open' : '' ?>><summary><span>Prueba local de integración</span><span class="expand-mark" aria-hidden="true">+</span></summary><div class="integration-content"><p class="muted">Envía un pedido por RabbitMQ al consumidor real. Se registrará un pago.</p><form method="post"><input name="csrf" type="hidden" value="<?= h($_SESSION['payment_csrf']) ?>"><?php foreach (['Pedido'=>['pedidoId'=>'Pedido ID','clienteId'=>'Cliente ID','total'=>'Total'],'Producto de prueba'=>['productoId'=>'Producto ID','cantidad'=>'Cantidad','precio'=>'Precio']] as $group=>$fields): ?><fieldset><legend><?= h($group) ?></legend><div class="fields"><?php foreach ($fields as $name=>$label): ?><label<?= $name === 'total' ? ' class="field-wide"' : '' ?>><?= h($label) ?><input name="<?= h($name) ?>" type="<?= in_array($name,['total','precio'],true) ? 'text' : 'number' ?>"<?= in_array($name,['total','precio'],true) ? ' inputmode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" placeholder="0.00"' : ' min="1" max="2147483647"' ?> required value="<?= h(is_string($_POST[$name] ?? null) ? $_POST[$name] : '') ?>"></label><?php endforeach; ?></div></fieldset><?php endforeach; ?><button type="submit" class="button secondary full-width">Enviar pedido de prueba</button></form></div></details></section>
<?php endif; ?></div><div class="result-column"><div id="result-container" data-pedido="<?= h($query) ?>"><?php require __DIR__ . '/_result.php'; ?></div><p id="poll-status" class="poll-status" aria-live="polite"></p></div></div>
<?php pageEnd(true); ?>