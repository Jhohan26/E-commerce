<?php
declare(strict_types=1);
namespace Pagos;



final class PendingRecovery
{
    private int $afterId = 0;
    public function run(int $limit, callable $list, callable $publish, callable $onError, callable $canContinue): array
    {
        $ids = $list($limit, $this->afterId);
        if ($ids === [] && $this->afterId > 0) {
            $this->afterId = 0;
            $ids = $list($limit, 0);
        }
        $report = ['published' => 0, 'failed' => 0];
        foreach ($ids as $id) {


            $this->afterId = $id;
            try {
                if ($publish($id)) { $report['published']++; }
            } catch (\Exception $error) {
                if ($error instanceof \PDOException || !$canContinue()) { throw $error; }
                $report['failed']++;
                $onError($id, $error);
            }
        }
        return $report;
    }
}
