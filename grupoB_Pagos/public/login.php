<?php
declare(strict_types=1);

require_once __DIR__ . '/_session.php';
require_once __DIR__ . '/_layout.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    exit;
}

pageStart('login', 'Acceso');
?>

<section class="card lookup-card auth-card">
    <h1>Acceso a Pagos</h1>

    <p>Ingresa con tu usuario autorizado para operar el módulo de Pagos.</p>

    <form id="auth-form" class="lookup-form" action="auth-session.php" method="post">
        <label for="usuario">Usuario</label>

        <input
            id="usuario"
            name="usuario"
            type="text"
            required
            autocomplete="username"
        >

        <label for="password">Contraseña</label>

        <input
            id="password"
            name="password"
            type="password"
            required
            autocomplete="current-password"
        >

        <input type="hidden" name="csrf" value="<?= h($_SESSION['payment_csrf']) ?>">

        <button class="button" type="submit">Ingresar</button>

        <p id="auth-status" role="status" aria-live="polite"></p>
    </form>

    <details>
        <summary>Acceso temporal de desarrollo</summary>

        <form id="auth-token-form" class="lookup-form" action="auth-session.php" method="post">
            <label for="token">JWT</label>

            <textarea
                id="token"
                name="token"
                rows="6"
                required
                autocomplete="off"
                spellcheck="false"
            ></textarea>

            <input type="hidden" name="csrf" value="<?= h($_SESSION['payment_csrf']) ?>">

            <button class="button secondary" type="submit">Ingresar con JWT</button>

            <p id="token-auth-status" role="status" aria-live="polite"></p>
        </form>
    </details>
</section>

<script src="auth.js" defer></script>

<?php pageEnd(); ?>