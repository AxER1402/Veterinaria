<?php
declare(strict_types=1);

namespace Huellitas;

/** A05: toda credencial o API key se lee del entorno (.env), nunca del código. */
final class Env
{
    public static function get(string $nombre, ?string $defecto = null): ?string
    {
        $valor = getenv($nombre);
        return ($valor === false || $valor === '') ? $defecto : $valor;
    }

    public static function required(string $nombre): string
    {
        $valor = self::get($nombre);
        if ($valor === null) {
            error_log("Falta la variable de entorno $nombre");
            throw new ApiError(500, 'Servicio mal configurado');
        }
        return $valor;
    }
}
