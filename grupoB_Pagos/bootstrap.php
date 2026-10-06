<?php
declare(strict_types=1);

if (is_file(__DIR__ . '/vendor/autoload.php')) {
    require __DIR__ . '/vendor/autoload.php';
} else {
    spl_autoload_register(static function (string $class): void {
        if (str_starts_with($class, 'Pagos\\')) {
            $path = __DIR__ . '/src/' . substr($class, 6) . '.php';
            if (is_file($path)) { require $path; }
        }
    });
}
date_default_timezone_set('UTC');
return new Pagos\Config(__DIR__ . '/.env');
