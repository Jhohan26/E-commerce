<?php
declare(strict_types=1);
$approved = $row !== null && $row['estado'] === 'APROBADO';
$rejected = $row !== null && $row['estado'] === 'RECHAZADO';
$awaitingDecision = $row !== null && $row['estado'] === 'PENDIENTE';
?>
<section id="payment-result" class="card payment-result <?= $approved ? 'approved' : ($rejected ? 'rejected' : 'pending') ?>" aria-live="polite" aria-atomic="true" data-final="<?= $approved || $rejected ? '1' : '0' ?>" data-published="<?= $row !== null && (int) $row['evento_publicado'] === 1 ? '1' : '0' ?>" data-awaiting-decision="<?= $awaitingDecision ? '1' : '0' ?>">
<?php if ($error !== null): ?>
    <div class="result-summary"><span class="status-icon error-icon" aria-hidden="true">!</span><h2>Consulta no disponible</h2><p class="alert" role="alert"><?= h($error) ?></p></div>
<?php elseif ($row !== null): ?>
    <div class="result-summary">
        <span class="status-icon" aria-hidden="true"><?= $approved ? '✓' : ($rejected ? '−' : '○') ?></span>
        <h2><?= $approved ? 'Pago aprobado.' : ($rejected ? 'Pago rechazado.' : 'Pendiente de decisión') ?></h2>
        <p class="result-caption">Pedido #<?= h($row['pedido_id']) ?></p>
        <div class="payment-amount"><?= h(number_format((float) $row['total'], 2, ',', '.')) ?></div><span class="amount-label">Total del pago</span>
    </div>
    <dl class="payment-details">
        <div><dt>Pedido</dt><dd>#<?= h($row['pedido_id']) ?></dd></div>
        <div><dt>Cliente ID</dt><dd>#<?= h($row['cliente_id']) ?></dd></div>
        <div><dt>Nombre del cliente</dt><dd data-client-name data-order-id="<?= h($row['pedido_id']) ?>" aria-live="polite">Consultando…</dd></div>
        <div><dt>Estado</dt><dd><span class="badge <?= $approved ? 'approved' : ($rejected ? 'rejected' : '') ?>"><?= h($row['estado']) ?></span></dd></div>
        <?php if (!empty($row['fecha_procesamiento'])): ?><div><dt><?= $awaitingDecision ? 'Recibido (UTC)' : 'Fecha (UTC)' ?></dt><dd class="date-value"><?= h($row['fecha_procesamiento']) ?></dd></div><?php endif; ?>
        <div><dt>Evento publicado</dt><dd class="publication-detail"><?= $awaitingDecision ? 'Esperando decisión' : ((int) $row['evento_publicado'] === 1 ? 'Publicación confirmada' : 'Pendiente de publicación') ?></dd></div>
    </dl>
    <?php if ($awaitingDecision): ?>
        <div class="manual-decision">
            <p class="muted"></p>
            <form method="post" action="decide.php" class="decision-form">
                <input type="hidden" name="csrf" value="<?= h($_SESSION['payment_csrf'] ?? '') ?>">
                <input type="hidden" name="pedidoId" value="<?= h($row['pedido_id']) ?>">
                <label for="rejection-reason">Motivo si rechazas (máximo 150 caracteres)</label>
                <input id="rejection-reason" name="motivo" maxlength="150" value="Rechazado manualmente por el operador">
                <div class="decision-buttons">
                    <button type="submit" name="estado" value="APROBADO" class="button">Pagar</button>
                    <button type="submit" name="estado" value="RECHAZADO" class="button danger">Rechazar</button>
                </div>
            </form>
        </div>
    <?php elseif ((int) $row['evento_publicado'] !== 1): ?>
        <p class="publication-notice" role="status">La decisión está guardada. El envío del JSON está pendiente; el consumidor activo o el comando recover lo reintentará.</p>
    <?php endif; ?>
    <?php if ($rejected && !empty($row['motivo_rechazo'])): ?><div class="reason"><span>Motivo de rechazo</span><p><?= h($row['motivo_rechazo']) ?></p></div><?php endif; ?>
    <div class="result-actions"><a class="quiet-link" href="history.php?pedidoId=<?= h($row['pedido_id']) ?>">Ver en historial <span aria-hidden="true">↗</span></a></div>
<?php elseif ($query !== ''): ?>
    <div class="result-summary waiting-summary"><span class="spinner" aria-hidden="true"></span><h2>Esperando resultado</h2><p class="result-caption">Pedido #<?= h($query) ?></p><p class="empty-description">Todavía no hay un pago registrado.<br>Cuando llegue el pedido podrás pagar o rechazar.</p><span class="badge">En espera</span></div>
<?php else: ?>
    <div class="result-summary waiting-summary"><span class="status-icon neutral-icon" aria-hidden="true">↗</span><h2>Estado de tu pago</h2><p class="empty-description">Ingresa un pedido para consultar su pago.<br>También puedes abrir los pedidos recibidos desde el historial.</p><a class="button secondary" href="history.php">Ver pedidos recibidos</a></div>
<?php endif; ?>
</section>
