<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Cache;
use Huellitas\Guard;

/**
 * Certificados públicos con los que Google firma sus tokens de identidad. Vive aquí porque
 * notificaciones-service tiene salida a Internet y auth-service no. Google los cambia cada varios
 * días: se guardan el tiempo que indica su Cache-Control.
 */
final class GoogleController
{
    private const URL = 'https://www.googleapis.com/oauth2/v1/certs';
    private const CACHE = 'google:certificados';
    private const TTL_MIN = 300;
    private const TTL_MAX = 21600;

    public function certificados(): array
    {
        Guard::servicio(['auth-service']);
        $guardado = Cache::redis()->get(self::CACHE);
        if (is_string($guardado) && is_array($certificados = json_decode($guardado, true))) {
            return [200, ['certificados' => $certificados]];
        }

        $ttl = self::TTL_MIN;
        $ch = curl_init(self::URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            // Menos que los 4 s que espera auth-service: así responde 503 controlado y no un timeout.
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT        => 3,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
            CURLOPT_HEADERFUNCTION => static function ($ch, string $linea) use (&$ttl): int {
                if (preg_match('/^cache-control:.*max-age=(\d+)/i', $linea, $m)) {
                    $ttl = max(self::TTL_MIN, min(self::TTL_MAX, (int) $m[1]));
                }
                return strlen($linea);
            },
        ]);
        $respuesta = curl_exec($ch);
        $http = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $certificados = $http === 200 && is_string($respuesta) ? json_decode($respuesta, true) : null;
        if (!is_array($certificados) || !$certificados) {
            error_log('Google: los certificados respondieron ' . $http);
            throw new ApiError(503, 'No se pudo verificar tu cuenta de Google en este momento');
        }
        Cache::redis()->setex(self::CACHE, $ttl, json_encode($certificados));
        return [200, ['certificados' => $certificados]];
    }
}
