<?php
declare(strict_types=1);
namespace Pagos;

final class Config
{
    private array $values = [];
    public function __construct(string $file)
    {
        if (is_file($file)) {
            foreach (file($file, FILE_IGNORE_NEW_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || str_starts_with($line, '#')) { continue; }
                if (!str_contains($line, '=')) { throw new \RuntimeException('Linea invalida en .env'); }
                [$key, $value] = explode('=', $line, 2);
                $value = trim($value);
                if (strlen($value) >= 2 && (($value[0] === '"' && str_ends_with($value, '"')) || ($value[0] === "'" && str_ends_with($value, "'")))) {
                    $value = substr($value, 1, -1);
                }
                $this->values[trim($key)] = $value;
            }
        }
    }
    public function get(string $key, ?string $default = null): string
    {
        $environment = getenv($key);
        $value = $environment !== false ? $environment : ($this->values[$key] ?? $default);
        if ($value === null) { throw new \RuntimeException("Falta configurar $key en .env o entorno"); }
        return $value;
    }
    public function positiveInt(string $key, int $default): int
    {
        $value = $this->get($key, (string) $default);
        if (!ctype_digit($value) || (int) $value < 1) { throw new \RuntimeException("Configuracion invalida: $key"); }
        return (int) $value;
    }
    public function inputEvent(): string
    {
        $event = $this->get('AMQP_EVENT_INPUT', 'PedidoCreado');
        if ($event === '' || trim($event) !== $event) { throw new \RuntimeException('Configuracion invalida: AMQP_EVENT_INPUT'); }
        return $event;
    }
}
