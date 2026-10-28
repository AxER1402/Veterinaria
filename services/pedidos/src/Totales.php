<?php
declare(strict_types=1);

namespace App;

/**
 * Cálculo del total en el servidor, en centavos enteros (sin errores de coma flotante).
 * T de STRIDE: precios, descuento y envío nunca se toman del navegador.
 */
final class Totales
{
    public const ENVIO_GRATIS_DESDE = 40000;  // Q400.00
    public const COSTO_ENVIO = 3500;          // Q35.00

    /**
     * @param list<array{precio: string, cantidad: int, marca: string}> $lineas  líneas cotizadas por catalogo-service
     * @param ?array{porcentaje: int|string, marca: ?string} $cupon
     */
    public static function calcular(array $lineas, ?array $cupon, string $metodoEntrega): array
    {
        $subtotal = 0;
        $elegible = 0;
        foreach ($lineas as $l) {
            $importe = self::centavos($l['precio']) * $l['cantidad'];
            $subtotal += $importe;
            if ($cupon && ($cupon['marca'] === null || $cupon['marca'] === $l['marca'])) {
                $elegible += $importe;
            }
        }
        $descuento = $cupon ? (int) round($elegible * (int) $cupon['porcentaje'] / 100) : 0;
        $conDescuento = $subtotal - $descuento;
        $envio = ($metodoEntrega === 'retiro' || $conDescuento >= self::ENVIO_GRATIS_DESDE) ? 0 : self::COSTO_ENVIO;

        return [
            'subtotal'  => $subtotal,
            'descuento' => $descuento,
            'envio'     => $envio,
            'total'     => $conDescuento + $envio,
        ];
    }

    public static function centavos(string|int|float $monto): int
    {
        return (int) round((float) $monto * 100);
    }

    public static function decimal(int $centavos): string
    {
        return number_format($centavos / 100, 2, '.', '');
    }

    /** Para respuestas JSON. */
    public static function aJson(array $totales): array
    {
        return array_map(fn(int $c) => round($c / 100, 2), $totales);
    }
}
