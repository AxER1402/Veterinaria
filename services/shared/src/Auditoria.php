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
        [$codigo] = Interno::post($url, $evento, 3);

        if ($codigo !== 201) {
            $json = json_encode($evento, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            error_log("AUDITORIA_PENDIENTE servicio=$servicio http=$codigo evento=$json");
        }
    }

    /** Datos del actor (usuario_id, email, rol) a partir de los claims del JWT. */
    public static function actor(array $claims): array
    {
        return ['usuario_id' => (int) $claims['sub'], 'usuario_email' => $claims['email'], 'rol' => $claims['rol']];
    }
}
