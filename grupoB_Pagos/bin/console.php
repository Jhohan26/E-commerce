<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

use Pagos\{Broker, Database, PaymentRepository, Processor, Simulator};
use PhpAmqpLib\Exception\AMQPTimeoutException;
use PhpAmqpLib\Message\AMQPMessage;

$broker = null;
$exitCode = 0;
try {
    $config = require dirname(__DIR__) . '/bootstrap.php';
    $command = $argv[1] ?? 'help';
    if ($command === 'help') {
        echo "Comandos: check-db | setup [--demo-results] | publish archivo.json | consume [--max=N] [--idle-timeout=N] | recover | observe [--max=N] [--idle-timeout=N]\n";
        exit(0);
    }
    if ($command === 'check-db') {
        $pdo = Database::connect($config);
        $columns = $pdo->query('SHOW COLUMNS FROM pagos')->fetchAll();
        $expected = ['id', 'pedido_id', 'cliente_id', 'total', 'estado', 'motivo_rechazo', 'fecha_procesamiento', 'evento_publicado'];
        if (array_column($columns, 'Field') !== $expected) { throw new RuntimeException('El esquema no coincide; no se ha modificado'); }
        echo "Conexion y nombres de columnas correctos.\n";
        foreach ($columns as $column) { echo $column['Field'] . ': ' . $column['Type'] . ', key=' . $column['Key'] . "\n"; }
        echo 'Motor: ' . $pdo->query("SHOW TABLE STATUS WHERE Name = 'pagos'")->fetch()['Engine'] . " (se requiere InnoDB para bloqueo y recuperacion)\n";
        exit(0);
    }
    if (!in_array($command, ['setup', 'publish', 'consume', 'recover', 'observe'], true)) { throw new InvalidArgumentException('Comando desconocido'); }
    $broker = new Broker($config);
    $broker->setup(in_array('--demo-results', $argv, true));
    if ($command === 'setup') { echo "Topologia duradera preparada.\n"; }
    if ($command === 'publish') {
        $path = $argv[2] ?? '';
        if (!is_file($path)) { throw new InvalidArgumentException('Indica un archivo JSON existente'); }

        $broker->publishRaw(file_get_contents($path), $config->get('AMQP_KEY_INPUT', 'pedido.creado'));
        echo "Mensaje enviado y confirmado por RabbitMQ.\n";
    }
    $options = ['max' => 0, 'idle-timeout' => 0];
    foreach (array_slice($argv, 2) as $option) {
        if (preg_match('/^--(max|idle-timeout)=([1-9][0-9]*)$/D', $option, $match)) { $options[$match[1]] = (int) $match[2]; }
    }
    if ($command === 'observe') {
        echo "Observando cola demo. Ctrl+C para detener.\n";
        $count = 0; $last = time();
        while (true) {
            $message = $broker->channel->basic_get($config->get('AMQP_DEMO_QUEUE', 'pagos.resultados_demo'), false);
            if ($message !== null) {
                echo $message->getBody() . "\n";
                $message->ack(); $last = time(); $count++;
                if ($options['max'] > 0 && $count >= $options['max']) { break; }
            } else {
                if ($options['idle-timeout'] > 0 && time() - $last >= $options['idle-timeout']) { break; }

                try { $broker->channel->wait(null, false, 1); } catch (AMQPTimeoutException) {}
            }
        }
    }
    if ($command === 'consume' || $command === 'recover') {
        $pdo = Database::connect($config);
        $engine = $pdo->query("SHOW TABLE STATUS WHERE Name = 'pagos'")->fetch()['Engine'] ?? '';
        if (strcasecmp($engine, 'InnoDB') !== 0) { throw new RuntimeException('Se requiere InnoDB; no se ha modificado el esquema'); }
        $processor = new Processor(new PaymentRepository($pdo), new Simulator($config), $broker, $config->inputEvent());
        $recover = static function () use ($processor, $config): void {
            $report = $processor->recover($config->positiveInt('RECOVERY_BATCH', 100), static function (int $id, Throwable $error): void {
                fwrite(STDERR, "Pago $id pendiente; se continua con los demas: " . $error->getMessage() . "\n");
            });
            if ($report['published'] > 0 || $report['failed'] > 0) {
                echo "Recuperados: {$report['published']}; pendientes con error: {$report['failed']}\n";
            }
        };
        $recover();
        if ($command === 'recover') { echo "Lote de recuperacion terminado.\n"; }
        else {
            $broker->channel->basic_qos(0, 1, false);
            $count = 0; $lastMessage = time(); $lastRecovery = time();
            $broker->channel->basic_consume($config->get('AMQP_QUEUE', 'pagos.pedido_creado'), '', false, false, false, false,
                static function (AMQPMessage $message) use ($processor, &$count, &$lastMessage): void {
                    try {
                        $row = $processor->process($message->getBody());
                        $message->ack();
                        if ((int) $row['evento_publicado'] === 1) {
                            echo "Pedido {$row['pedido_id']}: {$row['estado']}; resultado confirmado o ya publicado.\n";
                        } else {
                            fwrite(STDERR, "Pedido {$row['pedido_id']} guardado; publicacion pendiente: {$row['publication_error']}\n");
                        }
                    } catch (InvalidArgumentException $e) {
                        $message->reject(false);
                        fwrite(STDERR, 'Mensaje descartado: ' . $e->getMessage() . "\n");
                    } catch (Throwable $e) {
                        $message->nack(true, false);

                        throw $e;
                    }
                    $count++; $lastMessage = time();
                }
            );
            echo "Consumidor activo. Ctrl+C para detener.\n";
            while ($broker->channel->is_consuming()) {
                try { $broker->channel->wait(null, false, 1); } catch (AMQPTimeoutException) {}
                if ($options['max'] > 0 && $count >= $options['max']) { break; }
                if ($options['idle-timeout'] > 0 && time() - $lastMessage >= $options['idle-timeout']) { break; }
                if (time() - $lastRecovery >= $config->positiveInt('RECOVERY_INTERVAL', 5)) { $recover(); $lastRecovery = time(); }
            }
        }
    }
} catch (Throwable $e) {

    fwrite(STDERR, 'Error: ' . $e->getMessage() . "\n");
    $exitCode = 1;
} finally {
    if ($broker !== null) { try { $broker->close(); } catch (Throwable) {} }
}
exit($exitCode);
