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
            'total'               => 'Q' . $total,
            'productos'           => implode("\n", array_map(
                fn($i) => sprintf('%d × %s (%s) — Q%s', $i['cantidad'], $i['nombre'], $i['etiqueta'], number_format((float) $i['subtotal'], 2)),
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

        $enviado = self::enviar('EMAILJS_TEMPLATE_ID', $parametros, $datosAuditoria);
        return [200, ['enviado' => $enviado, 'codigo_verificacion' => $codigo]];
    }

    private const PEDIDO_ESTADOS = [
        'preparando'   => ['titulo' => 'Estamos preparando tu pedido', 'mensaje' => 'Ya estamos juntando tus productos. Te avisaremos cuando salga o esté listo.'],
        'listo_retiro' => ['titulo' => 'Tu pedido está listo para retirar', 'mensaje' => 'Puedes pasar por él en la sede indicada, en nuestro horario de atención.'],
        'enviado'      => ['titulo' => 'Tu pedido va en camino', 'mensaje' => 'Tu pedido salió hacia la dirección de entrega.'],
        'entregado'    => ['titulo' => 'Tu pedido fue entregado', 'mensaje' => '¡Gracias por tu compra! Esperamos que a tu mascota le encante.'],
        'cancelado'    => ['titulo' => 'Tu pedido fue cancelado', 'mensaje' => 'Cancelamos tu pedido. Si ya lo habías pagado, te devolveremos el dinero por el mismo medio.'],
    ];

    /**
     * Aviso de cambio de estado de un pedido (pedidos-service). Usa la plantilla genérica de las citas
     * (título, mensaje y datos), así no hace falta otra plantilla en EmailJS.
     * Entrada: {pedido: <detalle de pedidos-service>, comentario?}
     */
    public function pedidoEstado(): array
    {
        Guard::servicio(['pedidos-service']);
        $d = Http::body();
        $p = $d['pedido'] ?? null;
        if (!is_array($p) || !isset($p['id'], $p['estado'], $p['contacto']['email']) || !isset(self::PEDIDO_ESTADOS[$p['estado']])) {
            throw new ApiError(422, 'Datos del pedido incompletos');
        }
        $email = filter_var($p['contacto']['email'], FILTER_VALIDATE_EMAIL) ?: throw new ApiError(422, 'Correo inválido');
        $comentario = is_string($d['comentario'] ?? null) ? mb_substr($d['comentario'], 0, 200) : '';
        $tipo = self::PEDIDO_ESTADOS[$p['estado']];
        $enviado = self::enviar('EMAILJS_TEMPLATE_CITA_ID', [
            'to_email'            => $email,
            'to_name'             => $p['contacto']['nombre'] ?? '',
            'titulo'              => $tipo['titulo'],
            'mensaje'             => $tipo['mensaje'] . ($comentario !== '' ? " Nota: $comentario" : ''),
            'estado'              => $p['estado'],
            'cita'                => strtoupper(substr($p['id'], 0, 8)),
            'servicio'            => 'Pedido de la tienda · Q' . number_format((float) ($p['total'] ?? 0), 2),
            'mascota'             => '',
            'sede'                => $p['metodo_entrega'] === 'retiro' ? (string) $p['sede'] : 'Envío a ' . ($p['direccion']['direccion'] ?? ''),
            'fecha'               => self::fechaLarga(new \DateTimeImmutable('today')),
            'hora'                => '',
            'codigo_verificacion' => '',
        ], [
            'usuario_email' => $email,
            'rol'           => 'cliente',
            'pedido_id'     => $p['id'],
            'dato_nuevo'    => ['plantilla' => "pedido_{$p['estado']}", 'proveedor' => 'EmailJS'],
        ]);
        return [200, ['enviado' => $enviado]];
    }

    private const CITA_TIPOS = [
        'reservada'  => ['titulo' => 'Recibimos tu cita', 'mensaje' => 'Tu cita quedó reservada. Te avisaremos cuando la confirmemos.'],
        'confirmada' => ['titulo' => 'Tu cita está confirmada', 'mensaje' => 'Te esperamos. Si no puedes venir, cancélala desde «Mis citas» hasta 2 horas antes.'],
        'reprogramada' => ['titulo' => 'Tu cita cambió de horario', 'mensaje' => 'Tu cita tiene un nuevo día y hora. Revisa los datos abajo y, si no te queda bien, cámbiala desde «Mis citas».'],
        'cancelada'  => ['titulo' => 'Tu cita fue cancelada', 'mensaje' => 'La clínica canceló tu cita. Puedes reservar otro horario en la página.'],
        'recordatorio' => ['titulo' => 'Mañana es tu cita', 'mensaje' => 'Te esperamos. Si no puedes venir, cancélala desde «Mis citas» hasta 2 horas antes.'],
    ];

    /**
     * Correo de una cita (citas-service). Entrada: {tipo, cita: {id, inicio "Y-m-d H:i", servicio, sede,
     * mascota, cliente_nombre, cliente_email}, comentario?}. Devuelve el código HMAC aunque el correo falle.
     */
    public function cita(): array
    {
        Guard::servicio(['citas-service']);
        $d = Http::body();
        $tipo = is_string($d['tipo'] ?? null) && isset(self::CITA_TIPOS[$d['tipo']]) ? $d['tipo'] : throw new ApiError(422, 'Tipo de correo no válido');
        $c = $d['cita'] ?? null;
        foreach (['id', 'inicio', 'servicio', 'sede', 'mascota', 'cliente_nombre', 'cliente_email'] as $campo) {
            if (!is_array($c) || !is_string($c[$campo] ?? null) || $c[$campo] === '') {
                throw new ApiError(422, 'Datos de la cita incompletos');
            }
        }
        $email = filter_var($c['cliente_email'], FILTER_VALIDATE_EMAIL) ?: throw new ApiError(422, 'Correo inválido');
        $inicio = \DateTimeImmutable::createFromFormat('!Y-m-d H:i', $c['inicio']) ?: throw new ApiError(422, 'Fecha de la cita inválida');
        $codigo = self::codigoCita($c['id'], $c['inicio']);

        $comentario = is_string($d['comentario'] ?? null) ? mb_substr($d['comentario'], 0, 200) : '';
        $parametros = [
            'to_email'            => $email,
            'to_name'             => $c['cliente_nombre'],
            'titulo'              => self::CITA_TIPOS[$tipo]['titulo'],
            'mensaje'             => self::CITA_TIPOS[$tipo]['mensaje'] . ($comentario !== '' ? " Motivo: $comentario" : ''),
            'estado'              => $tipo,
            'cita'                => strtoupper(substr($c['id'], 0, 8)),
            'servicio'            => $c['servicio'],
            'mascota'             => $c['mascota'],
            'sede'                => $c['sede'],
            'fecha'               => self::fechaLarga($inicio),
            'hora'                => $inicio->format('H:i'),
            'codigo_verificacion' => $codigo,
        ];
        $enviado = self::enviar('EMAILJS_TEMPLATE_CITA_ID', $parametros, [
            'usuario_email' => $email,
            'rol'           => 'cliente',
            'dato_nuevo'    => ['plantilla' => "cita_$tipo", 'proveedor' => 'EmailJS', 'cita_id' => $c['id'], 'codigo_verificacion' => $codigo],
        ]);
        return [200, ['enviado' => $enviado, 'codigo_verificacion' => $codigo]];
    }

    /**
     * Aviso de que vence una vacuna (tarea citas-recordatorios). Usa la misma plantilla que las citas.
     * Entrada: {vacuna_id, vacuna, proxima_dosis "Y-m-d", mascota, cliente_nombre, cliente_email}
     */
    public function vacuna(): array
    {
        Guard::servicio(['citas-service']);
        $d = Http::body();
        foreach (['vacuna_id', 'vacuna', 'proxima_dosis', 'mascota', 'cliente_nombre', 'cliente_email'] as $campo) {
            if (!is_string($d[$campo] ?? null) || $d[$campo] === '') {
                throw new ApiError(422, 'Datos de la vacuna incompletos');
            }
        }
        $email = filter_var($d['cliente_email'], FILTER_VALIDATE_EMAIL) ?: throw new ApiError(422, 'Correo inválido');
        $fecha = \DateTimeImmutable::createFromFormat('!Y-m-d', $d['proxima_dosis']) ?: throw new ApiError(422, 'Fecha inválida');
        $enviado = self::enviar('EMAILJS_TEMPLATE_CITA_ID', [
            'to_email'            => $email,
            'to_name'             => $d['cliente_nombre'],
            'titulo'              => "Se acerca el refuerzo de {$d['mascota']}",
            'mensaje'             => "La vacuna {$d['vacuna']} de {$d['mascota']} vence pronto. Reserva una consulta veterinaria para aplicar el refuerzo.",
            'estado'              => 'vacuna',
            'cita'                => '',
            'servicio'            => "Refuerzo: {$d['vacuna']}",
            'mascota'             => $d['mascota'],
            'sede'                => 'Clínica veterinaria y peluquería · 6a. avenida 9-35, zona 10',
            'fecha'               => self::fechaLarga($fecha),
            'hora'                => '',
            'codigo_verificacion' => '',
        ], [
            'usuario_email' => $email,
            'rol'           => 'cliente',
            'dato_nuevo'    => ['plantilla' => 'vacuna_por_vencer', 'proveedor' => 'EmailJS', 'vacuna_id' => $d['vacuna_id']],
        ]);
        return [200, ['enviado' => $enviado]];
    }

    /** Envía con EmailJS y deja EMAIL_ENVIADO en la bitácora (FALLO si no está configurado o falla). */
    private static function enviar(string $plantilla, array $parametros, array $datosAuditoria): bool
    {
        if (!self::configurado($plantilla)) {
            Auditoria::registrar('EMAIL_ENVIADO', 'FALLO', array_merge_recursive($datosAuditoria, ['dato_nuevo' => ['motivo' => 'EmailJS no configurado']]));
            return false;
        }

        $ch = curl_init(self::EMAILJS_URL);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode([
                'service_id'      => Env::required('EMAILJS_SERVICE_ID'),
                'template_id'     => Env::required($plantilla),
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
        return $enviado;
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

    /** «martes 20 de octubre de 2026» (la imagen no trae la extensión intl). */
    private static function fechaLarga(\DateTimeImmutable $f): string
    {
        $dias = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
        $meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        return sprintf('%s %d de %s de %d', $dias[(int) $f->format('N') - 1], (int) $f->format('j'), $meses[(int) $f->format('n') - 1], (int) $f->format('Y'));
    }

    /** Distinto prefijo que el del pedido: un código de pedido nunca sirve como código de cita. */
    private static function codigoCita(string $citaId, string $inicio): string
    {
        $hmac = hash_hmac('sha256', "cita|$citaId|$inicio", Env::required('COMPROBANTE_SECRET'));
        return strtoupper(implode('-', str_split(substr($hmac, 0, 16), 4)));
    }

    private static function configurado(string $plantilla): bool
    {
        foreach (['EMAILJS_SERVICE_ID', $plantilla, 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY'] as $v) {
            if (Env::get($v) === null) {
                return false;
            }
        }
        return true;
    }
}
