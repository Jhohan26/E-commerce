<?php
declare(strict_types=1);
namespace Pagos;

final class Processor
{
    private PendingRecovery $recovery;
    public function __construct(private PaymentRepository $repository, private Simulator $simulator, private Broker $broker, private string $inputEvent = 'PedidoCreado')
    {
        $this->recovery = new PendingRecovery();
    }
    public function process(string $body): array
    {
        $order = Order::fromJson($body, $this->inputEvent);
        $row = $this->repository->register($order, $this->simulator->decide($order));
        try {
            $this->repository->publishPending((int) $row['id'], [$this->broker, 'publishPayment']);
            $row['evento_publicado'] = 1;
        } catch (\Exception $error) {
            if ($error instanceof \PDOException || !$this->broker->isUsable()) { throw $error; }



            $row['evento_publicado'] = 0;
            $row['publication_error'] = $error->getMessage();
        }
        return $row;
    }
    public function recover(int $limit, callable $onError): array
    {
        return $this->recovery->run(
            $limit, [$this->repository, 'pending'],
            fn(int $id): bool => $this->repository->publishPending($id, [$this->broker, 'publishPayment']),
            $onError, [$this->broker, 'isUsable']
        );
    }
}
