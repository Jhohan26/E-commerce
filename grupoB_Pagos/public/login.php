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
<p>Acceso temporal de desarrollo. Pega un JWT válido de operador o administrador.</p>
<p>Genera los tokens locales desde PowerShell con <code>php tests/generate_tokens.php</code>. Este formulario no emite tokens ni sustituye el login del Grupo F.</p>
<form id="auth-form" class="lookup-form" action="auth-session.php" method="post">
<label for="token">JWT</label>
<textarea id="token" name="token" rows="8" required autocomplete="off" spellcheck="false"></textarea>
<input type="hidden" name="csrf" value="<?= h($_SESSION['payment_csrf']) ?>">
<button class="button" type="submit">Ingresar</button>
<p id="auth-status" role="status" aria-live="polite"></p>
</form>
</section>
<script src="auth.js" defer></script>
<?php pageEnd(); ?>