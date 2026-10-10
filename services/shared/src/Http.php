<?php
declare(strict_types=1);

namespace Huellitas;

final class Http
{
    private const MAX_BODY = 65536;

    public static function json(int $status, array $datos): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($datos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    /** Cuerpo JSON como arreglo; rechaza cuerpos enormes o mal formados. */
    public static function body(): array
    {
        $crudo = file_get_contents('php://input', false, null, 0, self::MAX_BODY + 1);
        if ($crudo === false || $crudo === '') {
            return [];
        }
        if (strlen($crudo) > self::MAX_BODY) {
            throw new ApiError(413, 'Solicitud demasiado grande');
        }
        $datos = json_decode($crudo, true);
        if (!is_array($datos)) {
            throw new ApiError(400, 'JSON inválido');
        }
        return $datos;
    }

    /**
     * IP del cliente. Los servicios no están expuestos: solo el gateway les habla,
     * y el gateway sobrescribe X-Real-IP con $remote_addr, así que no se puede falsear.
     */
    public static function ip(): string
    {
        $ip = $_SERVER['HTTP_X_REAL_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
        return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '0.0.0.0';
    }

    public static function userAgent(): string
    {
        return mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
    }

    public static function bearer(): ?string
    {
        $cabecera = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/^Bearer\s+([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)$/', $cabecera, $m)) {
            return $m[1];
        }
        return null;
    }
}
