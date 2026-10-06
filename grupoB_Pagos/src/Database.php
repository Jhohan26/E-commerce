<?php
declare(strict_types=1);
namespace Pagos;

final class Database
{
    public static function connect(Config $config): \PDO
    {
        $host = $config->get('DB_HOST', '127.0.0.1');
        $port = $config->positiveInt('DB_PORT', 3306);
        $name = $config->get('DB_NAME', 'db_pagos');
        if (!preg_match('/^[a-zA-Z0-9_]+$/D', $name) || str_contains($host, ';')) { throw new \RuntimeException('Nombre o host de base invalido'); }
        $pdo = new \PDO("mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4", $config->get('DB_USER'), $config->get('DB_PASSWORD'), [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
        return $pdo;
    }
}
