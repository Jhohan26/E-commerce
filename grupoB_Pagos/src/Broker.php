<?php
declare(strict_types=1);
namespace Pagos;

use PhpAmqpLib\Connection\AMQPStreamConnection;
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
        if (!class_exists(AMQPStreamConnection::class)) { throw new \RuntimeException('Ejecuta composer install'); }
        $this->connection = new AMQPStreamConnection(
            $config->get('AMQP_HOST', 'localhost'), $config->positiveInt('AMQP_PORT', 5672),
            $config->get('AMQP_USER'), $config->get('AMQP_PASSWORD'), $config->get('AMQP_VHOST', '/'),
            false, 'AMQPLAIN', null, 'en_US', $config->positiveInt('AMQP_CONNECT_TIMEOUT', 5),
            $config->positiveInt('AMQP_READ_TIMEOUT', 65), null, false, $config->positiveInt('AMQP_HEARTBEAT', 30)
        );
        $this->channel = $this->connection->channel();
        $this->publisher = $this->connection->channel();
        $this->publisher->confirm_select();
    }
    public function setup(bool $demo = false): void
    {
        $exchange = $this->config->get('AMQP_EXCHANGE', 'ecommerce.eventos');
        $this->channel->exchange_declare($exchange, 'topic', false, true, false);
        $queue = $this->config->get('AMQP_QUEUE', 'pagos.pedido_creado');
        $this->channel->queue_declare($queue, false, true, false, false);
        $this->channel->queue_bind($queue, $exchange, $this->config->get('AMQP_KEY_INPUT', 'pedido.creado'));
        if ($demo) {
            $queue = $this->config->get('AMQP_DEMO_QUEUE', 'pagos.resultados_demo');
            $this->channel->queue_declare($queue, false, true, false, false);
            foreach (['AMQP_KEY_APPROVED' => 'pago.aprobado', 'AMQP_KEY_REJECTED' => 'pago.rechazado'] as $key => $default) {
                $this->channel->queue_bind($queue, $exchange, $this->config->get($key, $default));
            }
        }
    }
    public function publishRaw(string $body, string $key, ?string $messageId = null): void
    {
        if (!$this->isUsable()) { throw new \RuntimeException('Conexion de publicacion inutilizable; reiniciar consumidor'); }
        $confirmed = false;
        $failed = null;
        $this->publisher->set_ack_handler(static function () use (&$confirmed): void { $confirmed = true; });
        $this->publisher->set_nack_handler(static function () use (&$failed): void { $failed = 'Broker rechazo la publicacion'; });
        $this->publisher->set_return_listener(static function () use (&$failed): void { $failed = 'Sin cola vinculada a la routing key; evento pendiente'; });
        $properties = ['content_type' => 'application/json', 'delivery_mode' => AMQPMessage::DELIVERY_MODE_PERSISTENT];
        if ($messageId !== null) { $properties['message_id'] = $messageId; }
        try {
            $this->publisher->basic_publish(new AMQPMessage($body, $properties), $this->config->get('AMQP_EXCHANGE', 'ecommerce.eventos'), $key, true);
            $this->publisher->wait_for_pending_acks_returns($this->config->positiveInt('AMQP_CONFIRM_TIMEOUT', 5));
        } catch (\Throwable $error) {

            $this->usable = false;
            throw $error;
        }
        if (!$confirmed && $failed === null) {
            $this->usable = false;
            throw new \RuntimeException('No se recibio confirmacion del broker');
        }
        if ($failed !== null) { throw new PublicationException($failed); }
    }
    public function publishPayment(array $row): void
    {
        $key = $row['estado'] === 'APROBADO' ? $this->config->get('AMQP_KEY_APPROVED', 'pago.aprobado') : $this->config->get('AMQP_KEY_REJECTED', 'pago.rechazado');
        $this->publishRaw(json_encode(PaymentEvent::fromRow($row), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), $key, 'pagos:' . $row['id']);
    }
    public function close(): void { $this->connection->close(); }
    public function isUsable(): bool
    {
        return $this->usable && $this->connection->isConnected() && $this->publisher->is_open() && $this->channel->is_open();
    }
}
