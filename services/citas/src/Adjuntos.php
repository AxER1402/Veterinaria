<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Env;

/**
 * Resultados de laboratorio y radiografías en Cloudinary. Son datos de salud (A.5.34): se suben como
 * «private», así que la URL pública no sirve; solo se descargan con un enlace firmado que genera
 * citas-service al abrir la ficha y que vence a los 10 minutos. El secreto nunca sale del servidor.
 */
final class Adjuntos
{
    public const CARPETA = 'huellitas/historial';
    private const VIGENCIA_SEG = 600;

    /** Parámetros firmados para que el navegador del veterinario suba directo a Cloudinary. */
    public static function firma(): array
    {
        $nube = Env::get('CLOUDINARY_CLOUD_NAME') ?? throw new ApiError(503, 'La subida de archivos no está configurada (CLOUDINARY_* en .env)');
        $parametros = ['folder' => self::CARPETA, 'timestamp' => time(), 'type' => 'private'];
        return $parametros + [
            'signature'  => self::firmar($parametros),
            'api_key'    => Env::required('CLOUDINARY_API_KEY'),
            'upload_url' => "https://api.cloudinary.com/v1_1/$nube/auto/upload",
        ];
    }

    /** Enlace de descarga firmado y con vencimiento (equivale a private_download_url del SDK). */
    public static function enlace(string $publicId, string $recurso, ?string $formato): string
    {
        $parametros = array_filter([
            'public_id' => $publicId, 'format' => $formato, 'type' => 'private',
            'timestamp' => time(), 'expires_at' => time() + self::VIGENCIA_SEG,
        ], fn($v) => $v !== null && $v !== '');
        $parametros['signature'] = self::firmar($parametros);
        $parametros['api_key'] = Env::required('CLOUDINARY_API_KEY');
        return 'https://api.cloudinary.com/v1_1/' . Env::required('CLOUDINARY_CLOUD_NAME') . "/$recurso/download?" . http_build_query($parametros);
    }

    public static function configurado(): bool
    {
        return Env::get('CLOUDINARY_CLOUD_NAME') !== null && Env::get('CLOUDINARY_API_SECRET') !== null;
    }

    private static function firmar(array $parametros): string
    {
        ksort($parametros);
        return sha1(urldecode(http_build_query($parametros)) . Env::required('CLOUDINARY_API_SECRET'));
    }
}
