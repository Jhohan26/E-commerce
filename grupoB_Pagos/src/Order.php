<?php
declare(strict_types=1);
namespace Pagos;

final class Order
{
    public function __construct(public readonly int $pedidoId, public readonly int $clienteId, public readonly string $total) {}
    public static function fromJson(string $body, string $expectedEvent = 'PedidoCreado'): self
    {
        if ($expectedEvent === '' || trim($expectedEvent) !== $expectedEvent) { throw new \RuntimeException('Nombre de evento de entrada invalido'); }
        try { $data = json_decode($body, true, 512, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING); }
        catch (\JsonException $e) { throw new \InvalidArgumentException('JSON invalido', 0, $e); }
        if (!is_array($data) || ($data['evento'] ?? null) !== $expectedEvent) {
            throw new \InvalidArgumentException('Evento de entrada distinto del configurado');
        }
        foreach (['pedidoId', 'clienteId'] as $field) {
            if (!isset($data[$field]) || !is_int($data[$field]) || $data[$field] < 1 || $data[$field] > 2147483647) {
                throw new \InvalidArgumentException("$field debe ser entero positivo compatible con INT");
            }
        }

        return new self($data['pedidoId'], $data['clienteId'], Money::fromJson($body));
    }
}
