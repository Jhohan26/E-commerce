<?php
declare(strict_types=1);
namespace Pagos;

use PhpAmqpLib\Connection\AMQPStreamConnection;
use PhpAmqpLib\Connection\AMQPSSLConnection;
use PhpAmqpLib\Channel\AMQPChannel;
use PhpAmqpLib\Message\AMQPMessage;

final class Broker
{
    public readonly AMQPStreamConnection $connection;
    public readonly AMQPChannel $channel;
    private AMQPChannel $publisher;
    private bool $usable = true;

    public function __construct(private Config $config)
    {
        if (!class_exists(AMQPStreamConnection::class)) {
            throw new \RuntimeException('Ejecuta composer install');
        }

        $url = $config->get('RABBITMQ_URL');
        $parts = parse_url($url);

        if ($parts === false) {
            throw new \RuntimeException('RABBITMQ_URL invalida');
        }

        $scheme = strtolower($parts['scheme'] ?? '');
        $host = $parts['host'] ?? '';
        $user = rawurldecode($parts['user'] ?? '');
        $password = rawurldecode($parts['pass'] ?? '');

        $port = (int) (
            $parts['port']
            ?? ($scheme === 'amqps' ? 5671 : 5672)
        );

        $path = $parts['path'] ?? '/';

        $vhost = ($path === '' || $path === '/')
            ? '/'
            : rawurldecode(ltrim($path, '/'));

        if (!in_array($scheme, ['amqp', 'amqps'], true)) {
            throw new \RuntimeException(
                'RABBITMQ_URL debe comenzar por amqp:// o amqps://'
            );
        }

        if ($host === '' || $user === '' || $password === '') {
            throw new \RuntimeException('RABBITMQ_URL incompleta');
        }

        if ($scheme === 'amqps') {
            $this->connection = new AMQPSSLConnection(
                $host,
                $port,
                $user,
                $password,
                $vhost,
                [
                    'verify_peer' => true,
                    'verify_peer_name' => true,
                    'peer_name' => $host
                ],
                [
                    'connection_timeout' => $config->positiveInt(
                        'AMQP_CONNECT_TIMEOUT',
                        5
                    ),
                    'read_write_timeout' => $config->positiveInt(
                        'AMQP_READ_TIMEOUT',
                        65
                    ),
                    'heartbeat' => $config->positiveInt(
                        'AMQP_HEARTBEAT',
                        30
                    )
                ]
            );
        } else {
            $this->connection = new AMQPStreamConnection(
                $host,
                $port,
                $user,
                $password,
                $vhost,
                false,
                'AMQPLAIN',
                null,
                'en_US',
                $config->positiveInt('AMQP_CONNECT_TIMEOUT', 5),
                $config->positiveInt('AMQP_READ_TIMEOUT', 65),
                null,
                false,
                $config->positiveInt('AMQP_HEARTBEAT', 30)
            );
        }

        $this->channel = $this->connection->channel();
        $this->publisher = $this->connection->channel();

        $this->publisher->confirm_select();
    }

    public function setup(bool $demo = false): void
    {
        $inputExchange = $this->config->get(
            'RABBITMQ_EXCHANGE_PEDIDOS',
            'pedidos_exchange'
        );

        $outputExchange = $this->config->get(
            'RABBITMQ_EXCHANGE_PAGOS',
            'pagos_exchange'
        );

        $queue = $this->config->get(
            'AMQP_QUEUE',
            'pagos_pedidos_queue'
        );

        $this->channel->exchange_declare(
            $inputExchange,
            'fanout',
            false,
            true,
            false
        );

        $this->channel->exchange_declare(
            $outputExchange,
            'topic',
            false,
            true,
            false
        );

        $this->channel->queue_declare(
            $queue,
            false,
            true,
            false,
            false
        );

        $this->channel->queue_bind(
            $queue,
            $inputExchange,
            ''
        );

        if ($demo) {
            $demoQueue = $this->config->get(
                'AMQP_DEMO_QUEUE',
                'pagos_resultados_demo'
            );

            $this->channel->queue_declare(
                $demoQueue,
                false,
                true,
                false,
                false
            );

            $this->channel->queue_bind(
                $demoQueue,
                $outputExchange,
                $this->config->get(
                    'AMQP_KEY_APPROVED',
                    'pago.aprobado'
                )
            );

            $this->channel->queue_bind(
                $demoQueue,
                $outputExchange,
                $this->config->get(
                    'AMQP_KEY_REJECTED',
                    'pago.rechazado'
                )
            );
        }
    }

    public function publishRaw(
        string $body,
        string $key = '',
        ?string $messageId = null
    ): void {
        $this->publishToExchange(
            $this->config->get(
                'RABBITMQ_EXCHANGE_PEDIDOS',
                'pedidos_exchange'
            ),
            $body,
            '',
            $messageId
        );
    }

    public function publishPayment(array $row): void
    {
        $key = $row['estado'] === 'APROBADO'
            ? $this->config->get(
                'AMQP_KEY_APPROVED',
                'pago.aprobado'
            )
            : $this->config->get(
                'AMQP_KEY_REJECTED',
                'pago.rechazado'
            );

        $this->publishToExchange(
            $this->config->get(
                'RABBITMQ_EXCHANGE_PAGOS',
                'pagos_exchange'
            ),
            json_encode(
                PaymentEvent::fromRow($row),
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE
            ),
            $key,
            'pagos:' . $row['id']
        );
    }

    private function publishToExchange(
        string $exchange,
        string $body,
        string $key,
        ?string $messageId = null
    ): void {
        if (!$this->isUsable()) {
            throw new \RuntimeException(
                'Conexion de publicacion inutilizable; reiniciar consumidor'
            );
        }

        $confirmed = false;
        $failed = null;

        $this->publisher->set_ack_handler(
            static function () use (&$confirmed): void {
                $confirmed = true;
            }
        );

        $this->publisher->set_nack_handler(
            static function () use (&$failed): void {
                $failed = 'Broker rechazo la publicacion';
            }
        );

        $this->publisher->set_return_listener(
            static function () use (&$failed): void {
                $failed = 'Sin cola vinculada al evento; publicacion pendiente';
            }
        );

        $properties = [
            'content_type' => 'application/json',
            'delivery_mode' => AMQPMessage::DELIVERY_MODE_PERSISTENT
        ];

        if ($messageId !== null) {
            $properties['message_id'] = $messageId;
        }

        try {
            $this->publisher->basic_publish(
                new AMQPMessage($body, $properties),
                $exchange,
                $key,
                true
            );

            $this->publisher->wait_for_pending_acks_returns(
                $this->config->positiveInt(
                    'AMQP_CONFIRM_TIMEOUT',
                    5
                )
            );
        } catch (\Throwable $error) {
            $this->usable = false;
            throw $error;
        }

        if (!$confirmed && $failed === null) {
            $this->usable = false;

            throw new \RuntimeException(
                'No se recibio confirmacion del broker'
            );
        }

        if ($failed !== null) {
            throw new PublicationException($failed);
        }
    }

    public function close(): void
    {
        $this->connection->close();
    }

    public function isUsable(): bool
    {
        return $this->usable
            && $this->connection->isConnected()
            && $this->publisher->is_open()
            && $this->channel->is_open();
    }
}