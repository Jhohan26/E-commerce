<?php
declare(strict_types=1);
namespace Pagos;

final class PaymentEvent
{
    public static function fromRow(array $row): array
    {
        if (!in_array($row['estado'], ['APROBADO', 'RECHAZADO'], true)) { throw new \RuntimeException('Estado persistido desconocido'); }
        $event = [
            'evento' => $row['estado'] === 'APROBADO' ? 'PagoAprobado' : 'PagoRechazado',
            'pedidoId' => (int) $row['pedido_id'], 'clienteId' => (int) $row['cliente_id'],
            'pagoId' => (int) $row['id'], 'total' => (float) $row['total'], 'estado' => $row['estado'],
            'fecha' => (new \DateTimeImmutable($row['fecha_procesamiento'], new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z'),
        ];
        if ($row['estado'] === 'RECHAZADO') { $event['motivo'] = $row['motivo_rechazo']; }
        return $event;
    }
}
