<?php
declare(strict_types=1);

use Pagos\Broker;
use Pagos\Database;
use Pagos\PaymentRepository;

require_once __DIR__ . '/_layout.php';
require_once __DIR__ . '/_auth.php';

requireAuth(['operador', 'administrador']);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    exit('Utiliza los botones Pagar o Rechazar del pedido.');
}

$broker = null;

try {
    if (
        !is_string($_POST['csrf'] ?? null)
        || !hash_equals($_SESSION['payment_csrf'], $_POST['csrf'])
    ) {
        http_response_code(403);
        throw new InvalidArgumentException(
            'La sesión del formulario expiró. Recarga el pedido.'
        );
    }

    $orderId = inputId($_POST['pedidoId'] ?? null);

    $state = $_POST['estado'] ?? '';
    $reason = $_POST['motivo'] ?? '';

    if (!is_string($state) || !is_string($reason)) {
        throw new InvalidArgumentException('Decisión inválida.');
    }

    $config = require dirname(__DIR__) . '/bootstrap.php';

    $repository = new PaymentRepository(
        Database::connect($config)
    );

    $row = $repository->decide(
        $orderId,
        $state,
        $reason
    );

    if ((int) $row['evento_publicado'] !== 1) {
        try {
            $broker = new Broker($config);
            $broker->setup();

            $repository->publishPending(
                (int) $row['id'],
                [$broker, 'publishPayment']
            );
        } catch (Throwable) {
        }
    }

    header(
        'Location: ./?pedidoId=' . $orderId,
        true,
        303
    );
} catch (InvalidArgumentException $error) {
    if (http_response_code() !== 403) {
        http_response_code(400);
    }

    $message = $error->getMessage();
} catch (DomainException $error) {
    http_response_code(409);
    $message = $error->getMessage();
} catch (Throwable) {
    http_response_code(503);
    $message = 'No fue posible confirmar la decisión. Consulta el pedido antes de reintentar.';
} finally {
    if ($broker !== null) {
        try {
            $broker->close();
        } catch (Throwable) {
        }
    }
}

if (isset($message)) {
    pageStart('payment', 'Decisión de pago');

    echo '<section class="card">';
    echo '<p class="alert" role="alert">' . h($message) . '</p>';
    echo '<a class="button" href="./' .
        (isset($orderId) ? '?pedidoId=' . $orderId : '') .
        '">Volver al pedido</a>';
    echo '</section>';

    pageEnd();
}