<?php
declare(strict_types=1);

namespace Huellitas;

/** Llamadas entre microservicios. Cada llamada lleva un JWT de servicio nuevo (Zero Trust). */
final class Interno
{
    /** @return array{0: int, 1: ?array} código HTTP (0 si no hubo conexión) y cuerpo JSON */
    public static function post(string $url, array $datos, int $timeout = 4): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($datos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . Jwt::tokenServicio(Env::required('SERVICE_NAME')),
                // Se propaga la IP y el navegador del cliente original para la bitácora.
                'X-Real-IP: ' . Http::ip(),
                'User-Agent: ' . Http::userAgent(),
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT        => $timeout,
        ]);
        $respuesta = curl_exec($ch);
        $codigo = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $json = is_string($respuesta) ? json_decode($respuesta, true) : null;
        return [$codigo, is_array($json) ? $json : null];
    }

    /** Igual que post(), pero convierte las fallas del otro servicio en ApiError. */
    public static function exigir(string $url, array $datos, string $servicio): array
    {
        [$codigo, $json] = self::post($url, $datos);
        if ($codigo >= 200 && $codigo < 300 && $json !== null) {
            return $json;
        }
        if ($codigo >= 400 && $codigo < 500 && isset($json['error'])) {
            // Errores de negocio (sin stock, producto inactivo…) se devuelven tal cual.
            throw new ApiError($codigo === 401 || $codigo === 403 ? 502 : $codigo, $json['error'], array_diff_key($json, ['error' => 1]));
        }
        error_log("Interno: $servicio respondió $codigo en $url");
        throw new ApiError(503, "El servicio de $servicio no está disponible, intenta de nuevo");
    }
}
