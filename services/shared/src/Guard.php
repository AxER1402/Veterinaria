<?php
declare(strict_types=1);

namespace Huellitas;

/**
 * Zero Trust: cada servicio valida el JWT en CADA petición, incluidas las internas.
 * A01 / A07 / E (STRIDE): el rol sale del token firmado, nunca del cuerpo de la petición.
 */
final class Guard
{
    /** Usuario autenticado; si se indican roles, el suyo debe estar entre ellos. */
    public static function usuario(array $roles = []): array
    {
        $token = Http::bearer() ?? throw new ApiError(401, 'Autenticación requerida');
        $claims = Jwt::verificar($token, Env::required('JWT_SECRET'), 'user');
        if (Cache::revocado($claims['jti'])) {
            throw new ApiError(401, 'Token revocado');
        }
        if ($roles && !in_array($claims['rol'] ?? null, $roles, true)) {
            throw new ApiError(403, 'No tienes permiso para esta acción');
        }
        return $claims;
    }

    /** Llamada de otro microservicio; solo se aceptan los servicios listados. */
    public static function servicio(array $permitidos): string
    {
        $token = Http::bearer() ?? throw new ApiError(401, 'Autenticación de servicio requerida');
        $claims = Jwt::verificar($token, Env::required('SERVICE_JWT_SECRET'), 'service');
        if (!in_array($claims['sub'], $permitidos, true)) {
            throw new ApiError(403, 'Servicio no autorizado');
        }
        // Un token de servicio solo sirve una vez (anti-replay).
        if (!Cache::redis()->set("jwt:servicio:{$claims['jti']}", '1', ['nx', 'ex' => Jwt::TTL_SERVICIO + 30])) {
            throw new ApiError(401, 'Token de servicio reutilizado');
        }
        return $claims['sub'];
    }
}
