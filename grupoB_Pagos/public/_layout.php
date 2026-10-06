<?php
declare(strict_types=1);
function h(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
function pageStart(string $active, string $title): void
{
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    header('X-Content-Type-Options: nosniff');
    ?>
<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title><?= h($title) ?> · Pagos</title><link rel="stylesheet" href="style.css"></head>
<body><a class="skip-link" href="#main">Ir al contenido</a><header class="app-header"><a class="brand" href="./" aria-label="Pagos, inicio">pagos.</a><nav aria-label="Navegación principal"><?php foreach (['payment'=>['./','Pago'],'history'=>['history.php','Historial']] as $key=>[$url,$label]): ?><a href="<?= h($url) ?>"<?= $active === $key ? ' aria-current="page"' : '' ?>><?= h($label) ?></a><?php endforeach; ?></nav></header><main id="main">
<?php
}
function pageEnd(bool $poll = false): void
{
    ?></main><?php if ($poll): ?><script src="demo.js" defer></script><?php endif; ?></body></html><?php
}
function inputId(mixed $value): int
{
    if (!is_string($value) || !preg_match('/^[0-9]{1,10}$/D', $value) || (int) $value < 1 || (int) $value > 2147483647) { throw new InvalidArgumentException('Los identificadores y la cantidad deben ser enteros positivos hasta 2147483647.'); }
    return (int) $value;
}