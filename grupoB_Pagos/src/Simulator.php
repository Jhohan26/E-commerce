<?php
declare(strict_types=1);
namespace Pagos;

final class Simulator
{
    private array $rejectedOrderIds = [];
    private string $reason;
    public function __construct(Config $config)
    {
        $ids = trim($config->get('PAYMENT_REJECT_ORDER_IDS', ''));
        if ($ids !== '') {
            foreach (explode(',', $ids) as $value) {
                $value = trim($value);
                if (!preg_match('/^[1-9][0-9]{0,9}$/D', $value) || (int) $value > 2147483647) { throw new \RuntimeException('PAYMENT_REJECT_ORDER_IDS requiere una lista de enteros positivos hasta 2147483647'); }
                $this->rejectedOrderIds[(int) $value] = true;
            }
        }
        $this->reason = $config->get('PAYMENT_REJECTION_REASON', 'Rechazo de prueba configurado');
        if ($this->reason === '' || mb_strlen($this->reason) > 150) { throw new \RuntimeException('Motivo debe tener entre 1 y 150 caracteres'); }
    }
    public function decide(Order $order): array
    {
        $approved = !isset($this->rejectedOrderIds[$order->pedidoId]);
        return ['estado' => $approved ? 'APROBADO' : 'RECHAZADO', 'motivo_rechazo' => $approved ? null : $this->reason];
    }
}
