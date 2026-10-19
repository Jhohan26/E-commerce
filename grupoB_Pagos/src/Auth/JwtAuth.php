<?php
declare(strict_types=1);

namespace Pagos\Auth;

use Firebase\JWT\ExpiredException;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Pagos\Config;

final class JwtAuth
{
    public function __construct(private Config $config) {}

    public function authenticate(array $server): AuthUser
    {
        $authorization = trim(
            (string) (
                $server['HTTP_AUTHORIZATION']
                ?? $server['REDIRECT_HTTP_AUTHORIZATION']
                ?? ''
            )
        );

        if (!preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches)) {
            throw new AuthException('Token requerido', 401);
        }

        return $this->authenticateToken(trim($matches[1]));
    }

    public function authenticateToken(string $token): AuthUser
    {
        if ($token === '') {
            throw new AuthException('Token requerido', 401);
        }

        $algorithm = strtoupper($this->config->get('JWT_ALGORITHM', 'HS256'));

        if ($algorithm !== 'HS256') {
            throw new AuthException(
                'Algoritmo JWT no configurado para este servicio',
                500
            );
        }

        $secret = $this->config->get('JWT_SECRET', '');

        if ($secret === '') {
            throw new AuthException('JWT_SECRET no configurado', 500);
        }

        try {
            $decoded = JWT::decode(
                $token,
                new Key($secret, $algorithm)
            );
        } catch (ExpiredException) {
            throw new AuthException('Token vencido', 401);
        } catch (\Throwable) {
            throw new AuthException('Token invalido', 401);
        }

        $claims = json_decode(
            json_encode($decoded, JSON_THROW_ON_ERROR),
            true,
            512,
            JSON_THROW_ON_ERROR
        );

        if (!is_array($claims)) {
            throw new AuthException('Token invalido', 401);
        }

        if (!isset($claims['exp']) || !is_int($claims['exp']) || $claims['exp'] <= time()) {
            throw new AuthException('Token sin expiracion valida', 401);
        }
        $issuer = trim($this->config->get('JWT_ISSUER', ''));

        if ($issuer !== '' && ($claims['iss'] ?? null) !== $issuer) {
            throw new AuthException('Emisor de token invalido', 401);
        }

        $userClaim = $this->config->get('JWT_USER_CLAIM', 'sub');
        $roleClaim = $this->config->get('JWT_ROLE_CLAIM', 'role');
        $clientClaim = $this->config->get('JWT_CLIENT_CLAIM', 'clienteId');

        $userId = $claims[$userClaim] ?? null;
        $role = $claims[$roleClaim] ?? null;
        $clientId = $claims[$clientClaim] ?? null;

        if (
            (!is_string($userId) && !is_int($userId))
            || trim((string) $userId) === ''
        ) {
            throw new AuthException('Token sin identificador de usuario', 401);
        }

        if (!is_string($role) || trim($role) === '') {
            throw new AuthException('Token sin rol', 401);
        }

        $resolvedClientId = null;

        if ($clientId !== null) {
            if (
                (!is_int($clientId) && !(is_string($clientId) && ctype_digit($clientId)))
                || (int) $clientId < 1
            ) {
                throw new AuthException(
                    'Identificador de cliente invalido',
                    401
                );
            }

            $resolvedClientId = (int) $clientId;
        }

        return new AuthUser(
            trim((string) $userId),
            trim($role),
            $resolvedClientId,
            $claims
        );
    }

    public function requireRoles(AuthUser $user, array $roles): void
    {
        if (!$user->hasAnyRole($roles)) {
            throw new AuthException('Acceso denegado', 403);
        }
    }
}