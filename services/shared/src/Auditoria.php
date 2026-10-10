<?php
declare(strict_types=1);

namespace Huellitas;

/**
 * A09: cliente del security-audit-service. Cada servicio reporta sus eventos aquí.
 * Si el servicio de auditoría no responde, el evento queda en el log del contenedor
 * (stderr) para no perderlo, y la operación de negocio sigue.
 */
final class Auditoria
{
    /**
     * @param array{usuario_id?: ?int, usuario_email?: ?string, rol?: string, pedido_id?: ?string,
     *              pago_id?: ?string, dato_anterior?: mixed, dato_nuevo?: mixed} $datos
     */
    public static function registrar(string $accion, string $resultado, array $datos = []): void
    {
        $evento = [
            'accion'     => $accion,
            'resultado'  => $resultado,
            'ip_origen'  => Http::ip(),
            'user_agent' => Http::userAgent(),
        ] + $datos;

        $servicio = Env::required('SERVICE_NAME');
        $url = rtrim(Env::get('AUDIT_URL', 'http://security-audit-service:8086'), '/') . '/internal/eventos';
        $json = json_encode($evento, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $json,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . Jwt::tokenServicio($servicio),
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT        => 3,
        ]);
        $respuesta = curl_exec($ch);
        $codigo = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);

        if ($respuesta === false || $codigo !== 201) {
            error_log("AUDITORIA_PENDIENTE servicio=$servicio http=$codigo evento=$json");
        }
    }
}
