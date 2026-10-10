<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Auditoria;
use Huellitas\Env;
use Huellitas\Guard;
use Huellitas\Http;

/**
 * Correos transaccionales vía EmailJS (REST, del lado del servidor: las claves no llegan al navegador).
 * R de STRIDE: cada comprobante lleva un código HMAC del pedido, el total y la referencia del pago;
 * si el cliente niega la compra, el código se puede recalcular y comparar.
 */
final class NotificacionesController
{
    private const EMAILJS_URL = 'https://api.emailjs.com/api/v1.0/email/send';

    /** Entrada: {pedido: <detalle de pedidos-service>, metodo, referencia} */
    public function pedidoPagado(): array
    {
        Guard::servicio(['pedidos-service']);
        $d = Http::body();
        $p = $d['pedido'] ?? null;
        if (!is_array($p) || !isset($p['id'], $p['total'], $p['contacto']['email'], $p['items']) || !is_string($d['referencia'] ?? null)) {
            throw new ApiError(422, 'Datos del pedido incompletos');
        }
        $email = filter_var($p['contacto']['email'], FILTER_VALIDATE_EMAIL) ?: throw new ApiError(422, 'Correo inválido');
        $total = number_format((float) $p['total'], 2, '.', '');
        $codigo = self::codigo($p['id'], $total, $d['referencia']);

        $parametros = [
            'to_email'            => $email,
            'to_name'             => $p['contacto']['nombre'] ?? '',
            'pedido'              => strtoupper(substr($p['id'], 0, 8)),
            'pedido_id'           => $p['id'],
            'total'               => '$' . $total,
            'productos'           => implode("\n", array_map(
                fn($i) => sprintf('%d × %s (%s) — $%s', $i['cantidad'], $i['nombre'], $i['etiqueta'], number_format((float) $i['subtotal'], 2)),
                $p['items'])),
            'entrega'             => $p['metodo_entrega'] === 'retiro' ? 'Retiro en ' . $p['sede'] : 'Envío a ' . ($p['direccion']['direccion'] ?? ''),
            'metodo_pago'         => $d['metodo'] === 'paypal' ? 'PayPal' : 'Tarjeta (Stripe)',
            'referencia_pago'     => $d['referencia'],
            'codigo_verificacion' => $codigo,
        ];

        $datosAuditoria = [
            'usuario_email' => $email,
            'rol'           => 'cliente',
            'pedido_id'     => $p['id'],
            'dato_nuevo'    => ['plantilla' => 'pedido_pagado', 'proveedor' => 'EmailJS', 'codigo_verificacion' => $codigo],
        ];

        if (!self::configurado()) {
            Auditoria::registrar('EMAIL_ENVIADO', 'FALLO', array_merge_recursive($datosAuditoria, ['dato_nuevo' => ['motivo' => 'EmailJS no configurado']]));
            return [200, ['enviado' => false, 'motivo' => 'EmailJS no configurado', 'codigo_verificacion' => $codigo]];
        }

        $ch = curl_init(self::EMAILJS_URL);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode([
                'service_id'      => Env::required('EMAILJS_SERVICE_ID'),
                'template_id'     => Env::required('EMAILJS_TEMPLATE_ID'),
                'user_id'         => Env::required('EMAILJS_PUBLIC_KEY'),
                'accessToken'     => Env::required('EMAILJS_PRIVATE_KEY'),
                'template_params' => $parametros,
            ], JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        ]);
        $respuesta = curl_exec($ch);
        $http = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $enviado = $respuesta !== false && $http === 200;

        Auditoria::registrar('EMAIL_ENVIADO', $enviado ? 'EXITO' : 'FALLO', $enviado ? $datosAuditoria
            : array_merge_recursive($datosAuditoria, ['dato_nuevo' => ['motivo' => "EmailJS respondió $http"]]));
        if (!$enviado) {
            error_log("EmailJS respondió $http: " . substr((string) $respuesta, 0, 200));
        }
        return [200, ['enviado' => $enviado, 'codigo_verificacion' => $codigo]];
    }

    /** Comprueba un código de comprobante (lo usa el panel admin ante un reclamo). */
    public function verificar(): array
    {
        Guard::servicio(['pedidos-service']);
        $d = Http::body();
        foreach (['pedido_id', 'total', 'referencia', 'codigo'] as $c) {
            if (!is_string($d[$c] ?? null)) {
                throw new ApiError(422, "Falta $c");
            }
        }
        return [200, ['valido' => hash_equals(self::codigo($d['pedido_id'], $d['total'], $d['referencia']), strtoupper($d['codigo']))]];
    }

    private static function codigo(string $pedidoId, string $total, string $referencia): string
    {
        $hmac = hash_hmac('sha256', "$pedidoId|$total|$referencia", Env::required('COMPROBANTE_SECRET'));
        return strtoupper(implode('-', str_split(substr($hmac, 0, 16), 4)));
    }

    private static function configurado(): bool
    {
        foreach (['EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY'] as $v) {
            if (Env::get($v) === null) {
                return false;
            }
        }
        return true;
    }
}
