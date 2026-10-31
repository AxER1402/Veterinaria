<?php
declare(strict_types=1);

namespace App;

/**
 * Verifica el token de identidad (ID token) que entrega el botón de Google. No hace falta el secreto
 * de cliente: la firma se comprueba con los certificados públicos de Google, que trae
 * notificaciones-service porque auth-service no tiene salida a Internet.
 */
final class Google
{
    private const EMISORES = ['accounts.google.com', 'https://accounts.google.com'];
    private const TOLERANCIA_SEG = 60;

    /**
     * @param array<string, string> $certificados kid → certificado PEM
     * @return ?array los datos del token, o null si no es válido
     */
    public static function verificar(string $token, string $clientId, array $certificados): ?array
    {
        $partes = explode('.', $token);
        if (count($partes) !== 3) {
            return null;
        }
        [$cabecera, $datos, $firma] = array_map(self::base64url(...), $partes);
        $cabecera = json_decode((string) $cabecera, true);
        $datos = json_decode((string) $datos, true);
        if (!is_array($cabecera) || !is_array($datos) || !is_string($firma)) {
            return null;
        }
        // El algoritmo se exige fijo: no se acepta el que diga el propio token.
        $certificado = is_string($cabecera['kid'] ?? null) ? ($certificados[$cabecera['kid']] ?? null) : null;
        if (($cabecera['alg'] ?? null) !== 'RS256' || !is_string($certificado)) {
            return null;
        }
        if (openssl_verify("{$partes[0]}.{$partes[1]}", $firma, $certificado, OPENSSL_ALGO_SHA256) !== 1) {
            return null;
        }
        $ahora = time();
        $valido = in_array($datos['iss'] ?? null, self::EMISORES, true)
            && ($datos['aud'] ?? null) === $clientId
            && (!isset($datos['azp']) || $datos['azp'] === $clientId)
            && is_int($datos['exp'] ?? null) && $datos['exp'] + self::TOLERANCIA_SEG > $ahora
            && is_int($datos['iat'] ?? null) && $datos['iat'] - self::TOLERANCIA_SEG <= $ahora
            && is_string($datos['sub'] ?? null) && $datos['sub'] !== '' && strlen($datos['sub']) <= 255
            && is_string($datos['email'] ?? null)
            && in_array($datos['email_verified'] ?? null, [true, 'true'], true);
        return $valido ? $datos : null;
    }

    private static function base64url(string $texto): string|false
    {
        return base64_decode(strtr($texto, '-_', '+/'), true);
    }
}
