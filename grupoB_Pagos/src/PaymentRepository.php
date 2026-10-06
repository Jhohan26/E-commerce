<?php
declare(strict_types=1);
namespace Pagos;

final class PaymentRepository
{
    public function __construct(private \PDO $pdo) {}
    public function register(Order $order, array $decision): array
    {
        try {
            $statement = $this->pdo->prepare('INSERT INTO pagos (pedido_id, cliente_id, total, estado, motivo_rechazo, fecha_procesamiento, evento_publicado) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), 0)');
            $statement->execute([$order->pedidoId, $order->clienteId, $order->total, $decision['estado'], $decision['motivo_rechazo']]);
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
        $statement = $this->pdo->prepare('SELECT id FROM pagos WHERE evento_publicado = 0 AND id > ? ORDER BY id LIMIT ?');
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
            if (!$row || (int) $row['evento_publicado'] === 1) { $this->pdo->commit(); return false; }
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
    public function history(?int $orderId): array
    {
        $statement = $this->pdo->prepare('SELECT * FROM pagos' . ($orderId !== null ? ' WHERE pedido_id = ?' : '') . ' ORDER BY id DESC LIMIT 200');
        $statement->execute($orderId !== null ? [$orderId] : []);
        return $statement->fetchAll();
    }
}
