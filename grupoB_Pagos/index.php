<?php
declare(strict_types=1);
header('Location: public/' . ($_GET !== [] ? '?' . http_build_query($_GET) : ''));
exit;