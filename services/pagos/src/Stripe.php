<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Env;

final class Stripe
{
    private const API = 'https://api.stripe.com/v1';
    private const TOLERANCIA_SEG = 300;  // firmas con más de 5 min se rechazan (anti-replay)

    public static function configurado(): bool
    {
        return Env::get('STRIPE_SECRET_KEY') !== null && Env::get('STRIPE_PUBLISHABLE_KEY') !== null;
    }

    /**
     * Crea (o recupera) el PaymentIntent del pedido. La Idempotency-Key hace que repetir la
     * llamada para el mismo pedido y monto devuelva el mismo PaymentIntent.
     */
    public static function crearIntento(string $pedidoId, int $centavos, int $idCliente): array
    {
        $parametros = http_build_query([
            'amount'                             => $centavos,
            'currency'                           => 'usd',
            'automatic_payment_methods[enabled]' => 'true',
            'description'                        => 'Pedido Huellitas ' . strtoupper(substr($pedidoId, 0, 8)),
            'metadata[pedido_id]'                => $pedidoId,
            'metadata[id_cliente]'               => $idCliente,
        ]);
        [$codigo, $json] = Pasarela::llamar('POST', self::API . '/payment_intents', [
            'Authorization: Bearer ' . Env::required('STRIPE_SECRET_KEY'),
            'Content-Type: application/x-www-form-urlencoded',
            "Idempotency-Key: pi-$pedidoId-$centavos",
        ], $parametros);

        if ($codigo !== 200 || !isset($json['id'], $json['client_secret'])) {
            error_log('Stripe respondió ' . $codigo . ': ' . ($json['error']['message'] ?? 'sin detalle'));
            throw new ApiError(502, 'No se pudo iniciar el pago con tarjeta');
        }
        return $json;
    }

    /**
     * A08 / PCI-DSS: verificación de la cabecera Stripe-Signature.
     * Formato: "t=<unix>,v1=<hmac_sha256(t.payload)>[,v1=…]". Se acepta si alguna v1 coincide
     * (comparación en tiempo constante) y la marca de tiempo está dentro de la tolerancia.
     */
    public static function firmaValida(string $payload, string $cabecera, ?int $ahora = null): bool
    {
        $secreto = Env::get('STRIPE_WEBHOOK_SECRET');
        if ($secreto === null || $cabecera === '') {
            return false;
        }
        $t = null;
        $firmas = [];
        foreach (explode(',', $cabecera) as $parte) {
            [$clave, $valor] = array_pad(explode('=', trim($parte), 2), 2, '');
            if ($clave === 't' && ctype_digit($valor)) {
                $t = (int) $valor;
            } elseif ($clave === 'v1') {
                $firmas[] = $valor;
            }
        }
        if ($t === null || !$firmas || abs(($ahora ?? time()) - $t) > self::TOLERANCIA_SEG) {
            return false;
        }
        $esperada = hash_hmac('sha256', "$t.$payload", $secreto);
        foreach ($firmas as $firma) {
            if (hash_equals($esperada, $firma)) {
                return true;
            }
        }
        return false;
    }
}
