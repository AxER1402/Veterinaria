<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;

/** Llamadas HTTPS a Stripe / PayPal. Las API keys solo viven en el entorno del contenedor. */
final class Pasarela
{
    /** @return array{0: int, 1: ?array} */
    public static function llamar(string $metodo, string $url, array $cabeceras, ?string $cuerpo = null): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => $metodo,
            CURLOPT_HTTPHEADER     => $cabeceras,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => 15,
            // TLS verificado siempre (nunca CURLOPT_SSL_VERIFYPEER = false).
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        ]);
        if ($cuerpo !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $cuerpo);
        }
        $respuesta = curl_exec($ch);
        $codigo = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if ($respuesta === false) {
            error_log("Pasarela: sin conexión con $url: " . curl_error($ch));
            throw new ApiError(503, 'La pasarela de pago no responde, intenta de nuevo');
        }
        $json = json_decode($respuesta, true);
        return [$codigo, is_array($json) ? $json : null];
    }
}
