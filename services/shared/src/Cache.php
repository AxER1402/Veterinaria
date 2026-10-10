<?php
declare(strict_types=1);

namespace Huellitas;

/** Conexión única a Redis (lista negra de JWT, rate limiting, caché). */
final class Cache
{
    private static ?\Redis $redis = null;

    public static function redis(): \Redis
    {
        if (self::$redis === null) {
            try {
                $r = new \Redis();
                $r->connect(Env::get('REDIS_HOST', 'redis'), (int) Env::get('REDIS_PORT', '6379'), 1.5);
                $r->auth(Env::required('REDIS_PASSWORD'));
                self::$redis = $r;
            } catch (\RedisException $e) {
                error_log('Redis no disponible: ' . $e->getMessage());
                // Fail closed: sin Redis no se puede comprobar la lista negra.
                throw new ApiError(503, 'Servicio no disponible temporalmente');
            }
        }
        return self::$redis;
    }

    public static function revocar(string $jti, int $exp): void
    {
        $ttl = max(1, $exp - time());
        self::redis()->setex("jwt:revocado:$jti", $ttl, '1');
    }

    public static function revocado(string $jti): bool
    {
        return (bool) self::redis()->exists("jwt:revocado:$jti");
    }

    /** Contador con ventana fija; devuelve el número de golpes en la ventana. */
    public static function golpe(string $clave, int $ventana): int
    {
        $r = self::redis();
        $n = (int) $r->incr($clave);
        if ($n === 1) {
            $r->expire($clave, $ventana);
        }
        return $n;
    }
}
