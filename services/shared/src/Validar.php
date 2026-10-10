<?php
declare(strict_types=1);

namespace Huellitas;

/** A03: validación y saneamiento de entradas antes de tocar la BD. */
final class Validar
{
    // Segunda capa del WAF (la primera es Nginx, que no ve el cuerpo de la petición).
    private const PATRON_ATAQUE = '/(\bunion\b[\s\S]*\bselect\b|\b(or|and)\b\s+[\'"]?\d+[\'"]?\s*=\s*[\'"]?\d+|;\s*(drop|delete|update|insert|alter|truncate)\b|\bsleep\s*\(|\bbenchmark\s*\(|<\s*\/?\s*script|javascript:|\bon\w+\s*=|<\s*iframe|\.\.\/)/i';

    /** Revisa recursivamente todos los textos del cuerpo, salvo los campos indicados (p. ej. contraseñas). */
    public static function sinAtaques(array $datos, array $excluir = ['password']): void
    {
        array_walk_recursive($datos, static function ($valor, $clave) use ($excluir): void {
            if (is_string($valor) && !in_array($clave, $excluir, true) && preg_match(self::PATRON_ATAQUE, $valor)) {
                throw new ApiError(400, 'Contenido no permitido en la solicitud', ['campo' => $clave]);
            }
        });
    }

    public static function texto(array $datos, string $campo, int $min, int $max): string
    {
        $valor = $datos[$campo] ?? null;
        if (!is_string($valor)) {
            throw new ApiError(422, "El campo $campo es obligatorio", ['campo' => $campo]);
        }
        $valor = trim(strip_tags($valor));
        $largo = mb_strlen($valor);
        if ($largo < $min || $largo > $max) {
            throw new ApiError(422, "El campo $campo debe tener entre $min y $max caracteres", ['campo' => $campo]);
        }
        return $valor;
    }

    public static function email(array $datos, string $campo = 'email'): string
    {
        $valor = mb_strtolower(trim((string) ($datos[$campo] ?? '')));
        if (mb_strlen($valor) > 120 || !filter_var($valor, FILTER_VALIDATE_EMAIL)) {
            throw new ApiError(422, 'Correo electrónico inválido', ['campo' => $campo]);
        }
        return $valor;
    }

    /** Contraseña: 8–72 bytes (límite de bcrypt), con al menos una letra y un número. */
    public static function password(array $datos, string $campo = 'password'): string
    {
        $valor = $datos[$campo] ?? null;
        if (!is_string($valor) || strlen($valor) < 8 || strlen($valor) > 72
            || !preg_match('/\pL/u', $valor) || !preg_match('/\d/', $valor)) {
            throw new ApiError(422, 'La contraseña debe tener entre 8 y 72 caracteres, con letras y números', ['campo' => $campo]);
        }
        return $valor;
    }
}
