<?php
declare(strict_types=1);

namespace Huellitas;

/**
 * JWT HS256 sin dependencias.
 * E (STRIDE) / A07: solo se acepta HS256 (nunca "none"), la firma se compara en tiempo
 * constante y se exigen exp, iat, iss, typ y jti.
 */
final class Jwt
{
    public const TTL_USUARIO = 3600;  // A07: el token de cliente expira en 1 h
    public const TTL_SERVICIO = 60;   // token entre servicios: vida muy corta

    public static function firmar(array $claims, string $secreto): string
    {
        $cabecera = self::b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $cuerpo = self::b64(json_encode($claims, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $firma = self::b64(hash_hmac('sha256', "$cabecera.$cuerpo", $secreto, true));
        return "$cabecera.$cuerpo.$firma";
    }

    /** Devuelve los claims o lanza ApiError(401). */
    public static function verificar(string $token, string $secreto, string $tipo): array
    {
        $partes = explode('.', $token);
        if (count($partes) !== 3) {
            throw new ApiError(401, 'Token inválido');
        }
        [$cabecera, $cuerpo, $firma] = $partes;

        $h = json_decode(self::unb64($cabecera), true);
        if (!is_array($h) || ($h['alg'] ?? null) !== 'HS256') {
            throw new ApiError(401, 'Token inválido');
        }
        $esperada = self::b64(hash_hmac('sha256', "$cabecera.$cuerpo", $secreto, true));
        if (!hash_equals($esperada, $firma)) {
            throw new ApiError(401, 'Token inválido');
        }

        $c = json_decode(self::unb64($cuerpo), true);
        $ahora = time();
        if (!is_array($c)
            || ($c['iss'] ?? null) !== 'huellitas-auth'
            || ($c['typ'] ?? null) !== $tipo
            || !isset($c['sub'], $c['jti'], $c['iat'], $c['exp'])
            || $c['iat'] > $ahora + 30
        ) {
            throw new ApiError(401, 'Token inválido');
        }
        if ($c['exp'] < $ahora) {
            throw new ApiError(401, 'Token expirado');
        }
        return $c;
    }

    public static function tokenUsuario(array $usuario): array
    {
        $ahora = time();
        $claims = [
            'iss'   => 'huellitas-auth',
            'typ'   => 'user',
            'sub'   => (int) $usuario['id'],
            'email' => $usuario['email'],
            'rol'   => $usuario['rol'],
            'jti'   => self::uuid(),
            'iat'   => $ahora,
            'exp'   => $ahora + self::TTL_USUARIO,
        ];
        return [self::firmar($claims, Env::required('JWT_SECRET')), $claims];
    }

    /** Token que un servicio presenta a otro (Zero Trust: también se verifica). */
    public static function tokenServicio(string $servicio): string
    {
        $ahora = time();
        return self::firmar([
            'iss' => 'huellitas-auth',
            'typ' => 'service',
            'sub' => $servicio,
            'jti' => self::uuid(),
            'iat' => $ahora,
            'exp' => $ahora + self::TTL_SERVICIO,
        ], Env::required('SERVICE_JWT_SECRET'));
    }

    public static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }

    private static function b64(string $datos): string
    {
        return rtrim(strtr(base64_encode($datos), '+/', '-_'), '=');
    }

    private static function unb64(string $datos): string
    {
        return (string) base64_decode(strtr($datos, '-_', '+/'), true);
    }
}
