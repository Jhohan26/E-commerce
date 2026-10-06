<?php
declare(strict_types=1);
use Pagos\{Database, PaymentRepository};
require_once __DIR__ . '/_layout.php';
$rows = []; $error = null; $query = '';
try {
    $value = $_GET['pedidoId'] ?? $_GET['pedido'] ?? '';
    $id = $value === '' ? null : inputId($value);
    $query = $id === null ? '' : (string) $id;
    $config = require dirname(__DIR__) . '/bootstrap.php';
    $rows = (new PaymentRepository(Database::connect($config)))->history($id);
} catch (InvalidArgumentException $exception) { http_response_code(400); $error = $exception->getMessage(); }
catch (Throwable) { http_response_code(503); $error = 'No fue posible consultar los pagos. Intenta de nuevo más adelante.'; }
pageStart('history', 'Historial');
?>
<section class="page-heading"><h1>Historial</h1><p>Consulta los pagos registrados y la publicación de sus resultados.</p></section>
<section class="card history-card"><div class="history-toolbar"><div><h2>Pagos registrados</h2><p class="muted">Últimos 200 pagos · Fechas en UTC</p></div><form method="get" class="history-filter"><label for="pedido" class="visually-hidden">Pedido</label><input id="pedido" name="pedidoId" type="number" min="1" max="2147483647" value="<?= h($query) ?>" placeholder="Buscar por pedido"><button type="submit" class="button">Consultar / actualizar</button><a href="history.php" class="quiet-link">Ver todos</a></form></div><?php if ($error !== null): ?><p class="alert history-error" role="alert"><?= h($error) ?></p><?php endif; ?><div class="table-scroll" tabindex="0" role="region" aria-label="Tabla de pagos"><table><thead><tr><th scope="col">Pedido</th><th scope="col">Cliente</th><th scope="col" class="amount-cell">Total</th><th scope="col">Estado</th><th scope="col">Fecha (UTC)</th><th scope="col">Evento publicado</th></tr></thead><tbody><?php foreach ($rows as $row): ?><tr><td><a class="order-link" href="./?pedidoId=<?= h($row['pedido_id']) ?>">#<?= h($row['pedido_id']) ?></a></td><td class="client-cell">#<?= h($row['cliente_id']) ?></td><td class="amount-cell"><?= h(number_format((float) $row['total'], 2, ',', '.')) ?></td><td><span class="badge <?= $row['estado'] === 'APROBADO' ? 'approved' : ($row['estado'] === 'RECHAZADO' ? 'rejected' : '') ?>"><?= h($row['estado'] === 'APROBADO' ? 'Aprobado' : ($row['estado'] === 'RECHAZADO' ? 'Rechazado' : $row['estado'])) ?></span></td><td class="date-cell"><?= h(substr($row['fecha_procesamiento'],0,10)) ?><span><?= h(substr($row['fecha_procesamiento'],11)) ?></span></td><td><span class="publication <?= (int) $row['evento_publicado'] === 1 ? 'published' : '' ?>"><?= (int) $row['evento_publicado'] === 1 ? 'Publicado' : 'Pendiente' ?></span></td></tr><?php endforeach; ?><?php if ($rows === [] && $error === null): ?><tr><td colspan="6" class="empty"><strong>No hay pagos<?= $query !== '' ? ' para este pedido' : '' ?>.</strong><span>Los pagos aparecerán cuando el consumidor los registre.</span></td></tr><?php endif; ?></tbody></table></div></section>
<?php pageEnd(); ?>