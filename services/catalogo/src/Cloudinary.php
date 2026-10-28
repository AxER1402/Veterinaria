<?php
declare(strict_types=1);

namespace App;

use Huellitas\Env;

/**
 * Cloudinary como CDN de imágenes.
 * - Las imágenes externas se sirven por "fetch" (Cloudinary las descarga, optimiza y cachea).
 * - Las subidas del admin usan upload firmado: el secreto nunca sale del servidor (A05).
 */
final class Cloudinary
{
    public static function configurado(): bool
    {
        return Env::get('CLOUDINARY_CLOUD_NAME') !== null;
    }

    public static function url(string $origen, int $ancho = 600): string
    {
        $nube = Env::get('CLOUDINARY_CLOUD_NAME');
        if ($nube === null) {
            return $origen;
        }
        // Las subidas propias se piden ya recortadas y en el formato más liviano que acepte el navegador.
        if (self::esPropia($origen)) {
            return str_replace('/image/upload/', "/image/upload/f_auto,q_auto,c_fill,w_$ancho,h_$ancho/", $origen);
        }
        // El modo «fetch» viene bloqueado en las cuentas nuevas de Cloudinary (responde 401): solo se usa
        // si se activó en la cuenta (Settings → Security) y se pidió con CLOUDINARY_FETCH=1.
        if (Env::get('CLOUDINARY_FETCH') !== '1') {
            return $origen;
        }
        return "https://res.cloudinary.com/$nube/image/fetch/f_auto,q_auto,c_fill,w_$ancho,h_$ancho/" . rawurlencode($origen);
    }

    /** Solo se aceptan imágenes ya subidas a nuestra cuenta de Cloudinary. */
    public static function esPropia(string $url): bool
    {
        $nube = Env::get('CLOUDINARY_CLOUD_NAME');
        return $nube !== null
            && (bool) preg_match('#^https://res\.cloudinary\.com/' . preg_quote($nube, '#') . '/image/upload/[A-Za-z0-9_/.,\-]+$#', $url);
    }

    /** Parámetros firmados para que el navegador del admin suba directo a Cloudinary. */
    public static function firma(): array
    {
        $parametros = ['folder' => 'huellitas/productos', 'timestamp' => time()];
        ksort($parametros);
        $cadena = urldecode(http_build_query($parametros));
        return $parametros + [
            'signature'  => sha1($cadena . Env::required('CLOUDINARY_API_SECRET')),
            'api_key'    => Env::required('CLOUDINARY_API_KEY'),
            'cloud_name' => Env::required('CLOUDINARY_CLOUD_NAME'),
            'upload_url' => 'https://api.cloudinary.com/v1_1/' . Env::required('CLOUDINARY_CLOUD_NAME') . '/image/upload',
        ];
    }
}
