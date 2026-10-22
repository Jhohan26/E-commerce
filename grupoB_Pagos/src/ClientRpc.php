<?php
declare(strict_types=1);

namespace Pagos;

use PhpAmqpLib\Exception\AMQPTimeoutException;
use PhpAmqpLib\Message\AMQPMessage;
use PhpAmqpLib\Wire\AMQPTable;

final class ClientRpc
{
    private ?string $token = null;
    private int $tokenExpiresAt = 0;

    public function __construct(private Config $config)
    {
    }

    public static function nameFromResponse(
        array $response,
        int $id
    ): ?string {
        if (($response['status'] ?? null) === 404) {
            return null;
        }

        $client = $response['data'] ?? null;

        if (
            ($response['status'] ?? null) !== 200
            || !is_array($client)
            || (string) ($client['id'] ?? '') !== (string) $id
        ) {
            throw new \RuntimeException(
                'Respuesta de Clientes no valida'
            );
        }

        $parts = [];

        foreach (
            [
                'primer_nombre',
                'segundo_nombre',
                'primer_apellido',
                'segundo_apellido'
            ] as $field
        ) {
            if (
                isset($client[$field])
                && !is_string($client[$field])
            ) {
                throw new \RuntimeException(
                    'Nombre no valido'
                );
            }

            $part = trim($client[$field] ?? '');

            if ($part !== '') {
                $parts[] = $part;
            }
        }

        $name = implode(' ', $parts);

        if (
            $name === ''
            && is_string($client['nombre'] ?? null)
        ) {
            $name = trim($client['nombre']);
        }

        if (
            $name === ''
            || mb_strlen($name) > 200
        ) {
            throw new \RuntimeException(
                'Nombre no disponible'
            );
        }

        return $name;
    }

    public function login(
        string $usuario,
        string $password
    ): string {
        $usuario = trim($usuario);

        if ($usuario === '' || $password === '') {
            throw new \InvalidArgumentException(
                'Usuario y contraseña son obligatorios'
            );
        }

        $timeout = min(
            10,
            $this->config->positiveInt(
                'CLIENT_RPC_TIMEOUT',
                4
            )
        );

        $broker = new Broker($this->config);

        try {
            $response = $this->call(
                $broker,
                $this->config->get(
                    'CLIENT_AUTH_QUEUE',
                    'auth.login'
                ),
                [
                    'usuario' => $usuario,
                    'password' => $password
                ],
                $timeout
            );

            if (($response['status'] ?? null) !== 200) {
                throw new \RuntimeException(
                    'Usuario o contraseña incorrectos'
                );
            }

            $data = $response['data'] ?? null;

            if (!is_array($data)) {
                throw new \RuntimeException(
                    'Respuesta de autenticacion no valida'
                );
            }

            $token = $data['token'] ?? null;

            if (
                !is_string($token)
                || trim($token) === ''
            ) {
                throw new \RuntimeException(
                    'Clientes no devolvio un JWT valido'
                );
            }

            return trim($token);
        } finally {
            try {
                $broker->close();
            } catch (\Throwable) {
            }
        }
    }

    public function lookup(int $id): ?string
    {
        if ($id < 1) {
            throw new \InvalidArgumentException(
                'Cliente invalido'
            );
        }

        $timeout = min(
            10,
            $this->config->positiveInt(
                'CLIENT_RPC_TIMEOUT',
                4
            )
        );

        $broker = new Broker($this->config);

        try {
            $token = $this->getToken(
                $broker,
                $timeout
            );

            $response = $this->call(
                $broker,
                $this->config->get(
                    'CLIENT_RPC_QUEUE',
                    'cliente.consultar'
                ),
                ['id' => $id],
                $timeout,
                $token
            );

            if (($response['status'] ?? null) === 401) {
                $this->token = null;
                $this->tokenExpiresAt = 0;

                $token = $this->getToken(
                    $broker,
                    $timeout
                );

                $response = $this->call(
                    $broker,
                    $this->config->get(
                        'CLIENT_RPC_QUEUE',
                        'cliente.consultar'
                    ),
                    ['id' => $id],
                    $timeout,
                    $token
                );
            }

            if (($response['status'] ?? null) === 401) {
                throw new \RuntimeException(
                    'Clientes rechazo la autenticacion'
                );
            }

            return self::nameFromResponse(
                $response,
                $id
            );
        } finally {
            try {
                $broker->close();
            } catch (\Throwable) {
            }
        }
    }

    private function getToken(
        Broker $broker,
        int $timeout
    ): string {
        if (
            $this->token !== null
            && time() < $this->tokenExpiresAt
        ) {
            return $this->token;
        }

        $usuario = $this->config->get(
            'CLIENT_AUTH_USER'
        );

        $password = $this->config->get(
            'CLIENT_AUTH_PASSWORD'
        );

        if ($usuario === '' || $password === '') {
            throw new \RuntimeException(
                'Credenciales de Clientes no configuradas'
            );
        }

        $response = $this->call(
            $broker,
            $this->config->get(
                'CLIENT_AUTH_QUEUE',
                'auth.login'
            ),
            [
                'usuario' => $usuario,
                'password' => $password
            ],
            $timeout
        );

        if (($response['status'] ?? null) !== 200) {
            throw new \RuntimeException(
                'Login de Clientes rechazado'
            );
        }

        $data = $response['data'] ?? null;

        if (!is_array($data)) {
            throw new \RuntimeException(
                'Respuesta de login de Clientes no valida'
            );
        }

        $token = $data['token'] ?? null;
        $ttl = $data['expira_en_segundos'] ?? null;

        if (
            !is_string($token)
            || trim($token) === ''
            || !is_numeric($ttl)
            || (int) $ttl < 1
        ) {
            throw new \RuntimeException(
                'Token de Clientes no valido'
            );
        }

        $this->token = trim($token);

        $this->tokenExpiresAt = time()
            + max(
                1,
                (int) $ttl - 30
            );

        return $this->token;
    }

    private function call(
        Broker $broker,
        string $queue,
        array $payload,
        int $timeout,
        ?string $token = null
    ): array {
        $channel = $broker->channel;

        [$replyQueue] = $channel->queue_declare(
            '',
            false,
            false,
            true,
            true
        );

        $correlationId = bin2hex(
            random_bytes(16)
        );

        $response = null;
        $returned = false;

        $channel->set_return_listener(
            static function () use (&$returned): void {
                $returned = true;
            }
        );

        $channel->basic_consume(
            $replyQueue,
            '',
            false,
            true,
            false,
            false,
            static function (
                AMQPMessage $message
            ) use (
                $correlationId,
                &$response
            ): void {
                if (
                    $message->has('correlation_id')
                    && $message->get('correlation_id')
                        === $correlationId
                ) {
                    $decoded = json_decode(
                        $message->getBody(),
                        true,
                        512,
                        JSON_THROW_ON_ERROR
                    );

                    if (!is_array($decoded)) {
                        throw new \RuntimeException(
                            'Respuesta RPC invalida'
                        );
                    }

                    $response = $decoded;
                }
            }
        );

        $properties = [
            'content_type' => 'application/json',
            'reply_to' => $replyQueue,
            'correlation_id' => $correlationId,
            'expiration' => (string) (
                $timeout * 1000
            )
        ];

        if ($token !== null) {
            $properties['application_headers']
                = new AMQPTable([
                    'Authorization'
                        => 'Bearer ' . $token
                ]);
        }

        $channel->basic_publish(
            new AMQPMessage(
                json_encode(
                    $payload,
                    JSON_THROW_ON_ERROR
                ),
                $properties
            ),
            '',
            $queue,
            true
        );

        $deadline = microtime(true)
            + $timeout;

        while (
            $response === null
            && !$returned
            && ($remaining = $deadline - microtime(true)) > 0
        ) {
            try {
                $channel->wait(
                    null,
                    false,
                    $remaining
                );
            } catch (AMQPTimeoutException) {
                break;
            }
        }

        if ($response === null) {
            throw new \RuntimeException(
                'Clientes no disponible'
            );
        }

        return $response;
    }
}