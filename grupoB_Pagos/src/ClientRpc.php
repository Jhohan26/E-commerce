<?php
declare(strict_types=1);
namespace Pagos;

use PhpAmqpLib\Exception\AMQPTimeoutException;
use PhpAmqpLib\Message\AMQPMessage;

final class ClientRpc
{
    public function __construct(private Config $config) {}

    public static function nameFromResponse(array $response, int $id): ?string
    {
        if (($response['status'] ?? null) === 404) { return null; }
        $client = $response['data'] ?? null;
        if (($response['status'] ?? null) !== 200 || !is_array($client)
            || (string) ($client['id'] ?? '') !== (string) $id) {
            throw new \RuntimeException('Respuesta de Clientes no valida');
        }
        $parts = [];
        foreach (['primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido'] as $field) {
            if (isset($client[$field]) && !is_string($client[$field])) { throw new \RuntimeException('Nombre no valido'); }
            $part = trim($client[$field] ?? '');
            if ($part !== '') { $parts[] = $part; }
        }
        $name = implode(' ', $parts);
        if ($name === '' && is_string($client['nombre'] ?? null)) { $name = trim($client['nombre']); }
        if ($name === '' || mb_strlen($name) > 200) { throw new \RuntimeException('Nombre no disponible'); }
        return $name;
    }

    public function lookup(int $id): ?string
    {
        if ($id < 1) { throw new \InvalidArgumentException('Cliente invalido'); }
        $timeout = min(10, $this->config->positiveInt('CLIENT_RPC_TIMEOUT', 4));
        $broker = new Broker($this->config);
        try {
            // No setup(): esta consulta no declara ni utiliza exchanges de pagos.
            $channel = $broker->channel;
            [$replyQueue] = $channel->queue_declare('', false, false, true, true);
            $correlationId = bin2hex(random_bytes(16));
            $response = null;
            $returned = false;
            $channel->set_return_listener(static function () use (&$returned): void { $returned = true; });
            $channel->basic_consume($replyQueue, '', false, true, false, false,
                static function (AMQPMessage $message) use ($correlationId, &$response): void {
                    if ($message->has('correlation_id') && $message->get('correlation_id') === $correlationId) {
                        $response = json_decode($message->getBody(), true, 512, JSON_THROW_ON_ERROR);
                        if (!is_array($response)) { throw new \RuntimeException('Respuesta RPC invalida'); }
                    }
                });
            $channel->basic_publish(new AMQPMessage(json_encode(['id' => $id], JSON_THROW_ON_ERROR), [
                'content_type' => 'application/json', 'reply_to' => $replyQueue,
                'correlation_id' => $correlationId, 'expiration' => (string) ($timeout * 1000),
            ]), '', $this->config->get('CLIENT_RPC_QUEUE', 'cliente.consultar'), true);
            $deadline = microtime(true) + $timeout;
            while ($response === null && !$returned && ($remaining = $deadline - microtime(true)) > 0) {
                try { $channel->wait(null, false, $remaining); } catch (AMQPTimeoutException) { break; }
            }
            if ($response === null) { throw new \RuntimeException('Clientes no disponible'); }
            return self::nameFromResponse($response, $id);
        } finally { try { $broker->close(); } catch (\Throwable) {} }
    }
}
