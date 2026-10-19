<?php
declare(strict_types=1);

namespace Pagos\Auth;

final class AuthException extends \RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $httpStatus = 401
    ) {
        parent::__construct($message);
    }
}