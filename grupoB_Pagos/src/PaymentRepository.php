<?php
declare(strict_types=1);
namespace Pagos;

final class PaymentRepository
{
    public function __construct(private \PDO $pdo) {}
    public function register(Order $order): array
    {
        try {
            $statement = $this->pdo->prepare('INSERT INTO pagos (pedido_id, cliente_id, total, estado, motivo_rechazo, fecha_procesamiento, evento_publicado) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), 0)');
            $statement->execute([$order->pedidoId, $order->clienteId, $order->total, 'PENDIENTE', null]);
        } catch (\PDOException $e) {
            if ((int) ($e->errorInfo[1] ?? 0) !== 1062) { throw $e; }

        }
        $statement = $this->pdo->prepare('SELECT * FROM pagos WHERE pedido_id = ?');
        $statement->execute([$order->pedidoId]);
        $row = $statement->fetch();
        if (!$row) { throw new \RuntimeException('No se encontro el pago registrado'); }
        if ((int) $row['cliente_id'] !== $order->clienteId || $row['total'] !== $order->total) {
            throw new \InvalidArgumentException('pedidoId existente con clienteId o total diferente; se conserva el original');
        }
        return $row;
    }
    public function pending(int $limit, int $afterId = 0): array
    {
        $statement = $this->pdo->prepare("SELECT id FROM pagos WHERE evento_publicado = 0 AND estado IN ('APROBADO', 'RECHAZADO') AND id > ? ORDER BY id LIMIT ?");
        $statement->bindValue(1, $afterId, \PDO::PARAM_INT);
        $statement->bindValue(2, $limit, \PDO::PARAM_INT);
        $statement->execute();
        return array_map('intval', $statement->fetchAll(\PDO::FETCH_COLUMN));
    }
    public function publishPending(int $id, callable $publish): bool
    {


        $this->pdo->beginTransaction();
        try {
            $statement = $this->pdo->prepare('SELECT * FROM pagos WHERE id = ? FOR UPDATE');
            $statement->execute([$id]);
            $row = $statement->fetch();
            if (!$row || !in_array($row['estado'], ['APROBADO', 'RECHAZADO'], true) || (int) $row['evento_publicado'] === 1) { $this->pdo->commit(); return false; }
            $publish($row);
            $statement = $this->pdo->prepare('UPDATE pagos SET evento_publicado = 1 WHERE id = ?');
            $statement->execute([$id]);
            $this->pdo->commit();
            return true;
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) { $this->pdo->rollBack(); }
            throw $e;
        }
    }
    public function decide(int $orderId, string $state, string $reason = ''): array
    {
        if (!in_array($state, ['APROBADO', 'RECHAZADO'], true)) {
            throw new \InvalidArgumentException('Selecciona Pagar o Rechazar.');
        }
        $reason = trim($reason);
        if ($state === 'RECHAZADO' && ($reason === '' || mb_strlen($reason, 'UTF-8') > 150)) {
            throw new \InvalidArgumentException('El motivo de rechazo debe contener entre 1 y 150 caracteres.');
        }
        $this->pdo->beginTransaction();
        try {
            $statement = $this->pdo->prepare('SELECT * FROM pagos WHERE pedido_id = ? FOR UPDATE');
            $statement->execute([$orderId]);
            $row = $statement->fetch();
            if (!$row) { throw new \InvalidArgumentException('El pedido todavía no ha sido recibido por Pagos.'); }
            if ($row['estado'] !== 'PENDIENTE') {
                if ($row['estado'] !== $state) { throw new \DomainException('El pago ya fue resuelto; no se puede cambiar su resultado.'); }
                $this->pdo->commit();
                return $row; // Un doble clic no cambia la fecha ni el motivo original.
            }
            $statement = $this->pdo->prepare('UPDATE pagos SET estado = ?, motivo_rechazo = ?, fecha_procesamiento = UTC_TIMESTAMP(), evento_publicado = 0 WHERE id = ?');
            $statement->execute([$state, $state === 'RECHAZADO' ? $reason : null, $row['id']]);
            $statement = $this->pdo->prepare('SELECT * FROM pagos WHERE id = ?');
            $statement->execute([$row['id']]);
            $row = $statement->fetch();
            $this->pdo->commit();
            return $row;
        } catch (\Throwable $error) {
            if ($this->pdo->inTransaction()) { $this->pdo->rollBack(); }
            throw $error;
        }
    }
    public function history(?int $orderId): array
    {
        $statement = $this->pdo->prepare('SELECT * FROM pagos' . ($orderId !== null ? ' WHERE pedido_id = ?' : '') . ' ORDER BY id DESC LIMIT 200');
        $statement->execute($orderId !== null ? [$orderId] : []);
        return $statement->fetchAll();
    }
    public function awaitingDecision(): array
    {
        $rows = $this->pdo->query("SELECT pedido_id, cliente_id, total FROM pagos WHERE estado = 'PENDIENTE' ORDER BY id ASC LIMIT 100")->fetchAll();
        $total = (int) $this->pdo->query("SELECT COUNT(*) FROM pagos WHERE estado = 'PENDIENTE'")->fetchColumn();
        return ['rows' => $rows, 'total' => $total];
    }
}
