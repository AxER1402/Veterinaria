<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Env;

/**
 * TOTP (RFC 6238): códigos de 6 dígitos cada 30 s, HMAC-SHA1, compatibles con Google Authenticator,
 * Authy, 1Password, etc. El secreto se guarda cifrado con AES-256-GCM (A02 / A.8.24).
 */
final class Totp
{
    private const PERIODO = 30;
    private const DIGITOS = 6;
    private const VENTANA = 1;  // se acepta el paso anterior y el siguiente (desfase de reloj de ±30 s)
    private const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    public static function nuevoSecreto(): string
    {
        return self::base32(random_bytes(20));  // 160 bits, lo que recomienda el RFC 4226
    }

    public static function uri(string $secreto, string $email): string
    {
        $etiqueta = rawurlencode('Huellitas:' . $email);
        return "otpauth://totp/$etiqueta?secret=$secreto&issuer=Huellitas&algorithm=SHA1&digits=" . self::DIGITOS . '&period=' . self::PERIODO;
    }

    /**
     * Devuelve el paso de tiempo que coincide con el código, o null.
     * Un paso ya usado (≤ $ultimoPaso) no se acepta otra vez: evita reutilizar un código interceptado.
     */
    public static function verificar(string $secreto, string $codigo, ?int $ultimoPaso, ?int $ahora = null): ?int
    {
        if (!preg_match('/^\d{6}$/', $codigo)) {
            return null;
        }
        $clave = self::desdeBase32($secreto);
        $actual = intdiv($ahora ?? time(), self::PERIODO);
        for ($paso = $actual - self::VENTANA; $paso <= $actual + self::VENTANA; $paso++) {
            if ($ultimoPaso !== null && $paso <= $ultimoPaso) {
                continue;
            }
            if (hash_equals(self::codigo($clave, $paso), $codigo)) {
                return $paso;
            }
        }
        return null;
    }

    public static function codigo(string $clave, int $paso): string
    {
        $hmac = hash_hmac('sha1', pack('J', $paso), $clave, true);
        $offset = ord($hmac[19]) & 0x0f;
        $numero = (unpack('N', substr($hmac, $offset, 4))[1] & 0x7fffffff) % (10 ** self::DIGITOS);
        return str_pad((string) $numero, self::DIGITOS, '0', STR_PAD_LEFT);
    }

    // ---------- Cifrado del secreto en la BD ----------

    public static function cifrar(string $secreto): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $cifrado = openssl_encrypt($secreto, 'aes-256-gcm', self::llave(), OPENSSL_RAW_DATA, $iv, $tag, 'huellitas-mfa', 16);
        if ($cifrado === false) {
            throw new ApiError(500, 'No se pudo proteger el secreto');
        }
        return $iv . $tag . $cifrado;
    }

    public static function descifrar(string $guardado): string
    {
        $secreto = openssl_decrypt(substr($guardado, 28), 'aes-256-gcm', self::llave(), OPENSSL_RAW_DATA,
            substr($guardado, 0, 12), substr($guardado, 12, 16), 'huellitas-mfa');
        if ($secreto === false) {
            // Llave distinta o dato alterado: GCM lo detecta.
            error_log('MFA: el secreto guardado no se pudo descifrar (¿cambió MFA_ENCRYPTION_KEY?)');
            throw new ApiError(500, 'No se pudo verificar el segundo factor');
        }
        return $secreto;
    }

    private static function llave(): string
    {
        return hash('sha256', Env::required('MFA_ENCRYPTION_KEY'), true);
    }

    // ---------- Base32 (RFC 4648, sin relleno) ----------

    private static function base32(string $bytes): string
    {
        $bits = '';
        foreach (str_split($bytes) as $b) {
            $bits .= str_pad(decbin(ord($b)), 8, '0', STR_PAD_LEFT);
        }
        $salida = '';
        foreach (str_split($bits, 5) as $grupo) {
            $salida .= self::B32[bindec(str_pad($grupo, 5, '0'))];
        }
        return $salida;
    }

    private static function desdeBase32(string $texto): string
    {
        $bits = '';
        foreach (str_split(strtoupper(rtrim($texto, '='))) as $c) {
            $v = strpos(self::B32, $c);
            if ($v === false) {
                throw new ApiError(500, 'Secreto MFA inválido');
            }
            $bits .= str_pad(decbin($v), 5, '0', STR_PAD_LEFT);
        }
        $bytes = '';
        foreach (str_split($bits, 8) as $octeto) {
            if (strlen($octeto) === 8) {
                $bytes .= chr(bindec($octeto));
            }
        }
        return $bytes;
    }
}
