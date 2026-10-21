<?php

const CLOUDAMQP_URL="amqps://yychnpmp:GhdH4NfHUJq2kXLFvFCYNqbxV0w8OUcz@campbell.lmq.cloudamqp.com/yychnpmp";


require __DIR__ . '\vendor\autoload.php';

use PhpAmqpLib\Connection\AMQPConnectionConfig;
use PhpAmqpLib\Connection\AMQPConnectionFactory;
use PhpAmqpLib\Exception\AMQPTimeoutException;
use PhpAmqpLib\Message\AMQPMessage;


class ClienteRPC
{
	private $connection;
	private $channel;
	private string $colaRespuesta;
	private ?array $respuesta = null;
	private ?string $corrId = null;

	public function __construct(string $url)
	{
		$p = parse_url($url);
		if ($p === false || !isset($p['host'])) {
			throw new InvalidArgumentException('CLOUDAMQP_URL no es válida');
		}

		$seguro = ($p['scheme'] ?? 'amqps') === 'amqps';

		$config = new AMQPConnectionConfig();
		$config->setHost($p['host']);
		$config->setPort($p['port'] ?? ($seguro ? 5671 : 5672));
		$config->setUser(urldecode($p['user'] ?? 'guest'));
		$config->setPassword(urldecode($p['pass'] ?? 'guest'));
		$config->setVhost(isset($p['path']) ? urldecode(ltrim($p['path'], '/')) : '/');
		$config->setIsSecure($seguro);
		$config->setHeartbeat(30);

		$this->connection = AMQPConnectionFactory::create($config);
		$this->channel = $this->connection->channel();

		// Cola de respuesta exclusiva, con nombre generado por el servidor
		[$this->colaRespuesta] = $this->channel->queue_declare('', false, false, true, false);

		$this->channel->basic_consume(
			$this->colaRespuesta,
			'',
			false,
			true,   // no_ack (auto_ack)
			false,
			false,
			[$this, 'onResponse']
		);
	}

	public function onResponse(AMQPMessage $msg): void
	{
		if ($msg->get('correlation_id') === $this->corrId) {
			$this->respuesta = json_decode($msg->getBody(), true);
		}
	}

	public function llamar(string $cola, ?array $payload = null, int $timeout = 10): array
	{
		$this->respuesta = null;
		$this->corrId = bin2hex(random_bytes(16));

		$msg = new AMQPMessage(
			$payload !== null ? json_encode($payload, JSON_UNESCAPED_UNICODE) : '',
			[
				'reply_to'       => $this->colaRespuesta,
				'correlation_id' => $this->corrId,
				'expiration'     => (string)($timeout * 1000),
			]
		);
		$this->channel->basic_publish($msg, '', $cola);

		$limite = microtime(true) + $timeout;
		while ($this->respuesta === null) {
			$restante = $limite - microtime(true);
			if ($restante <= 0) {
				throw new RuntimeException('El worker no respondió a tiempo');
			}
			try {
				$this->channel->wait(null, false, $restante);
			} catch (AMQPTimeoutException $e) {
				throw new RuntimeException('El worker no respondió a tiempo');
			}
		}

		return $this->respuesta;
	}

	public function cerrar(): void
	{
		if ($this->channel) {
			$this->channel->close();
		}
		if ($this->connection) {
			$this->connection->close();
		}
	}
}

if (PHP_SAPI === 'cli' && realpath($argv[0]) === __FILE__) {
	$url = CLOUDAMQP_URL;
	if (!$url) {
		fwrite(STDERR, "Falta la variable CLOUDAMQP_URL\n");
		exit(1);
	}

	$rpc = new ClienteRPC($url);
	try {
		$resultado = isset($argv[1])
			? $rpc->llamar('cliente.consultar', ['id' => (int)$argv[1]])
			: $rpc->llamar('clientes.listar');

		echo json_encode($resultado, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), PHP_EOL;
	} finally {
		$rpc->cerrar();
	}
}