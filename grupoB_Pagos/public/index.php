<?php
declare(strict_types=1);

use Pagos\Database;
use Pagos\PaymentRepository;

require_once __DIR__ . '/_layout.php';
require_once __DIR__ . '/_auth.php';

$currentUser = requireAuth(['operador', 'administrador']);

$row = null;
$error = null;
$query = '';
$config = null;

try {
    $config = require dirname(__DIR__) . '/bootstrap.php';

    $rawQuery = $_GET['pedidoId'] ?? $_GET['pedido'] ?? '';

    if ($rawQuery !== '') {
        $query = (string) inputId($rawQuery);
    }

    if ($query !== '') {
        $repository = new PaymentRepository(
            Database::connect($config)
        );

        $row = $repository->history((int) $query)[0] ?? null;
    }
} catch (InvalidArgumentException $exception) {
    http_response_code(400);
    $error = $exception->getMessage();
} catch (Throwable) {
    http_response_code(503);
    $error = 'No fue posible consultar el pago. Intenta de nuevo más adelante.';
}

if (
    ($_GET['format'] ?? '') === 'json'
    && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET'
) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');

    ob_start();

    require __DIR__ . '/_result.php';

    $html = ob_get_clean();

    echo json_encode([
        'html' => $html,
        'final' => $row !== null
            && in_array(
                $row['estado'],
                ['APROBADO', 'RECHAZADO'],
                true
            ),
        'awaitingDecision' => $row !== null
            && $row['estado'] === 'PENDIENTE',
        'published' => $row !== null
            && (int) $row['evento_publicado'] === 1,
        'error' => $error !== null
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);

    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    $error = 'Esta pantalla solo permite consultar pedidos recibidos.';
}

pageStart('payment', 'Pago');
?>

<section class="page-heading">
    <h1>Pago</h1>
    <p>Consulta un pedido recibido y selecciona Pagar o Rechazar.</p>
</section>

<div class="payment-grid">

    <div class="payment-sidebar">
        <section class="card lookup-card">
            <div class="card-heading">
                <h2>Consultar pedido</h2>
                <p>Ingresa el identificador de tu pedido.</p>
            </div>

            <form method="get" class="lookup-form">
                <label for="lookup-order">
                    Pedido ID
                </label>

                <input
                    id="lookup-order"
                    name="pedidoId"
                    type="number"
                    min="1"
                    max="2147483647"
                    value="<?= h($query) ?>"
                    required
                    placeholder="Número de pedido"
                >

                <button
                    type="submit"
                    class="button full-width"
                >
                    Consultar pago
                    <span aria-hidden="true">→</span>
                </button>
            </form>
        </section>
    </div>

    <div class="result-column">
        <div
            id="result-container"
            data-pedido="<?= h($query) ?>"
        >
            <?php require __DIR__ . '/_result.php'; ?>
        </div>

        <p
            id="poll-status"
            class="poll-status"
            aria-live="polite"
        ></p>
    </div>

    <aside
        class="card pending-panel"
        aria-labelledby="pending-title"
    >
        <div class="pending-heading">
            <h2 id="pending-title">
                Pagos pendientes
            </h2>

            <span
                id="pending-count"
                class="badge"
            >
                —
            </span>
        </div>

        <p class="pending-description">
            Selecciona un pedido para pagar o rechazar.
        </p>

        <div id="pending-list">
            <p class="pending-empty">
                Cargando pendientes…
            </p>
        </div>

        <p
            id="pending-status"
            class="pending-status"
            role="status"
        ></p>

        <noscript>
            <p>
                Activa JavaScript para ver los pendientes aquí o consulta el historial.
            </p>
        </noscript>
    </aside>

</div>

<?php pageEnd(true); ?>