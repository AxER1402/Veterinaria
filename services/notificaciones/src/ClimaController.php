<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Cache;
use Huellitas\Env;
use Huellitas\Guard;

/**
 * Clima actual de Ciudad de Guatemala para el panel admin (planificar entregas).
 * Vive aquí porque notificaciones-service es, junto con pagos, el único con salida a Internet.
 * Con OPENWEATHER_API_KEY usa OpenWeatherMap; sin ella, Open-Meteo (no pide clave).
 * Se guarda 10 min en Redis: el plan free de OpenWeatherMap permite 1,000 llamadas al día.
 */
final class ClimaController
{
    private const LAT = 14.6349;
    private const LON = -90.5069;
    private const CACHE = 'clima:guatemala';
    private const TTL = 600;
    // Último dato bueno: si el proveedor no responde, el panel muestra este (marcado como desactualizado).
    private const ULTIMO = 'clima:guatemala:ultimo';
    private const TTL_ULTIMO = 86400;

    public function actual(): array
    {
        Guard::servicio(['pedidos-service']);
        $guardado = Cache::redis()->get(self::CACHE);
        if (is_string($guardado) && is_array($clima = json_decode($guardado, true))) {
            return [200, $clima];
        }

        $clima = Env::get('OPENWEATHER_API_KEY') !== null ? self::openWeather() : self::openMeteo();
        if ($clima === null) {
            $ultimo = Cache::redis()->get(self::ULTIMO);
            if (is_string($ultimo) && is_array($clima = json_decode($ultimo, true))) {
                return [200, ['desactualizado' => true] + $clima];
            }
            throw new ApiError(503, 'Clima no disponible');
        }
        $clima += ['ciudad' => 'Ciudad de Guatemala', 'actualizado' => date('c')];
        $json = json_encode($clima, JSON_UNESCAPED_UNICODE);
        Cache::redis()->setex(self::CACHE, self::TTL, $json);
        Cache::redis()->setex(self::ULTIMO, self::TTL_ULTIMO, $json);
        return [200, $clima];
    }

    private static function openWeather(): ?array
    {
        $j = self::get('https://api.openweathermap.org/data/2.5/weather?' . http_build_query([
            'lat' => self::LAT, 'lon' => self::LON, 'units' => 'metric', 'lang' => 'es', 'appid' => Env::required('OPENWEATHER_API_KEY'),
        ]));
        if (!isset($j['main']['temp'], $j['weather'][0]['description'])) {
            return null;
        }
        return [
            'temperatura' => round((float) $j['main']['temp'], 1),
            'sensacion'   => round((float) $j['main']['feels_like'], 1),
            'humedad'     => (int) $j['main']['humidity'],
            'viento_kmh'  => round((float) ($j['wind']['speed'] ?? 0) * 3.6),
            'descripcion' => mb_strtoupper(mb_substr($d = (string) $j['weather'][0]['description'], 0, 1)) . mb_substr($d, 1),
            'proveedor'   => 'OpenWeatherMap',
        ];
    }

    private static function openMeteo(): ?array
    {
        $j = self::get('https://api.open-meteo.com/v1/forecast?' . http_build_query([
            'latitude' => self::LAT, 'longitude' => self::LON, 'timezone' => 'America/Guatemala',
            'current' => 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
        ]));
        $c = $j['current'] ?? null;
        if (!isset($c['temperature_2m'], $c['weather_code'])) {
            return null;
        }
        return [
            'temperatura' => round((float) $c['temperature_2m'], 1),
            'sensacion'   => round((float) $c['apparent_temperature'], 1),
            'humedad'     => (int) $c['relative_humidity_2m'],
            'viento_kmh'  => round((float) $c['wind_speed_10m']),
            'descripcion' => self::wmo((int) $c['weather_code']),
            'proveedor'   => 'Open-Meteo',
        ];
    }

    /** Códigos WMO que devuelve Open-Meteo. */
    private static function wmo(int $codigo): string
    {
        return match (true) {
            $codigo === 0  => 'Despejado',
            $codigo <= 2   => 'Parcialmente nublado',
            $codigo === 3  => 'Nublado',
            $codigo <= 48  => 'Niebla',
            $codigo <= 57  => 'Llovizna',
            $codigo <= 67  => 'Lluvia',
            $codigo <= 77  => 'Nieve',
            $codigo <= 82  => 'Chubascos',
            default        => 'Tormenta',
        };
    }

    private static function get(string $url): ?array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            // Menos que los 4 s que espera pedidos-service: así responde 503 controlado y no un timeout.
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT        => 3,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        ]);
        $respuesta = curl_exec($ch);
        $http = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if ($respuesta === false || $http !== 200) {
            // Sin la URL: lleva la API key.
            error_log('Clima: el proveedor respondió ' . $http);
            return null;
        }
        $j = json_decode((string) $respuesta, true);
        return is_array($j) ? $j : null;
    }
}
