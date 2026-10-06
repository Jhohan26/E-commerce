<?php
declare(strict_types=1);
$query = $_GET['pedidoId'] ?? $_GET['pedido'] ?? '';
header('Location: ./' . (is_string($query) && $query !== '' ? '?pedidoId=' . rawurlencode($query) : ''), true, 302);
exit;