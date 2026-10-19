<?php
declare(strict_types=1);

namespace Pagos\Auth;

final class AuthUser
{
    public function __construct(
        public readonly string $id,
        public readonly string $role,
        public readonly ?int $clientId,
        public readonly array $claims
    ) {}

    public function hasAnyRole(array $roles): bool
    {
        return in_array($this->role, $roles, true);
    }
}