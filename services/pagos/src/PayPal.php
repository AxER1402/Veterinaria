<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Cache;
use Huellitas\Env;

/** PayPal Orders v2 (sandbox por defecto). La orden se crea y se captura del lado del servidor. */
final class PayPal
{
    public static function configurado(): bool
    {
        return Env::get('PAYPAL_CLIENT_ID') !== null && Env::get('PAYPAL_CLIENT_SECRET') !== null;
    }

    /** Quetzales por dólar (PAYPAL_TIPO_CAMBIO). PayPal no acepta GTQ: se cobra en USD. */
    public static function tipoCambio(): float
    {
        $tipo = (float) Env::get('PAYPAL_TIPO_CAMBIO', '7.75');
        return $tipo > 0 ? $tipo : throw new ApiError(503, 'El pago con PayPal no está habilitado en este entorno');
    }

    /** "500.00" (GTQ) → "64.52" (USD) */
    public static function aDolares(string $quetzales): string
    {
        return number_format(max(0.01, round((float) $quetzales / self::tipoCambio(), 2)), 2, '.', '');
    }

    public static function crearOrden(string $pedidoId, string $dolares): array
    {
        [$codigo, $json] = Pasarela::llamar('POST', self::base() . '/v2/checkout/orders', [
            'Authorization: Bearer ' . self::token(),
            'Content-Type: application/json',
            "PayPal-Request-Id: orden-$pedidoId-$dolares",   // idempotencia
        ], json_encode([
            'intent'         => 'CAPTURE',
            'purchase_units' => [[
                'reference_id' => $pedidoId,
                'custom_id'    => $pedidoId,
                'description'  => 'Pedido Huellitas ' . strtoupper(substr($pedidoId, 0, 8)),
                'amount'       => ['currency_code' => 'USD', 'value' => $dolares],
            ]],
        ]));
        if (!in_array($codigo, [200, 201], true) || !isset($json['id'])) {
            error_log("PayPal (crear orden) respondió $codigo");
            throw new ApiError(502, 'No se pudo iniciar el pago con PayPal');
        }
        return $json;
    }

    public static function capturar(string $ordenId): array
    {
        [$codigo, $json] = Pasarela::llamar('POST', self::base() . '/v2/checkout/orders/' . rawurlencode($ordenId) . '/capture', [
            'Authorization: Bearer ' . self::token(),
            'Content-Type: application/json',
            "PayPal-Request-Id: captura-$ordenId",
        ], '{}');
        // 422 ORDER_ALREADY_CAPTURED u otros errores de negocio se tratan como no confirmado.
        if (!in_array($codigo, [200, 201], true) || !is_array($json)) {
            error_log("PayPal (capturar) respondió $codigo");
            return ['status' => 'FAILED', 'detalle' => $json['details'][0]['issue'] ?? "HTTP $codigo"];
        }
        return $json;
    }

    /** Reembolso total de la captura de una orden. PayPal-Request-Id evita reembolsar dos veces. Devuelve el id. */
    public static function reembolsar(string $ordenId): string
    {
        [$codigo, $orden] = Pasarela::llamar('GET', self::base() . '/v2/checkout/orders/' . rawurlencode($ordenId), [
            'Authorization: Bearer ' . self::token(),
        ], null);
        $captura = $orden['purchase_units'][0]['payments']['captures'][0]['id'] ?? null;
        if ($codigo !== 200 || !is_string($captura)) {
            error_log("PayPal (orden para reembolso) respondió $codigo");
            throw new ApiError(502, 'No se encontró el cobro de PayPal para reembolsar');
        }
        [$codigo, $json] = Pasarela::llamar('POST', self::base() . '/v2/payments/captures/' . rawurlencode($captura) . '/refund', [
            'Authorization: Bearer ' . self::token(),
            'Content-Type: application/json',
            "PayPal-Request-Id: reembolso-$captura",
        ], '{}');
        if (!in_array($codigo, [200, 201], true) || !isset($json['id'])) {
            error_log("PayPal (reembolso) respondió $codigo");
            throw new ApiError(502, 'PayPal no pudo hacer el reembolso: ' . ($json['details'][0]['issue'] ?? "HTTP $codigo"));
        }
        return $json['id'];
    }

    private static function token(): string
    {
        $r = Cache::redis();
        $guardado = $r->get('paypal:token');
        if (is_string($guardado)) {
            return $guardado;
        }
        [$codigo, $json] = Pasarela::llamar('POST', self::base() . '/v1/oauth2/token', [
            'Authorization: Basic ' . base64_encode(Env::required('PAYPAL_CLIENT_ID') . ':' . Env::required('PAYPAL_CLIENT_SECRET')),
            'Content-Type: application/x-www-form-urlencoded',
        ], 'grant_type=client_credentials');
        if ($codigo !== 200 || !isset($json['access_token'])) {
            error_log("PayPal (token) respondió $codigo");
            throw new ApiError(502, 'No se pudo conectar con PayPal');
        }
        $r->setex('paypal:token', max(60, (int) ($json['expires_in'] ?? 3600) - 120), $json['access_token']);
        return $json['access_token'];
    }

    private static function base(): string
    {
        return rtrim(Env::get('PAYPAL_API_BASE', 'https://api-m.sandbox.paypal.com'), '/');
    }
}
