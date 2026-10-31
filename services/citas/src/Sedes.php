<?php
declare(strict_types=1);

namespace App;

use Huellitas\Db;

/** Sedes y horarios guardados en la base (se editan en el panel). Se leen una vez por petición, del maestro. */
final class Sedes
{
    private const TELEFONO_RESPALDO = '+502 2385-6420';
    private static ?array $todas = null;

    /** @return array<string, array> por código, con «horarios» (1 = lunes … 7 = domingo) */
    public static function todas(): array
    {
        if (self::$todas !== null) {
            return self::$todas;
        }
        $db = Db::escritura();
        $sedes = [];
        foreach ($db->query('SELECT * FROM sedes ORDER BY activa DESC, orden, nombre')->fetchAll() as $s) {
            $sedes[$s['codigo']] = $s + ['horarios' => []];
        }
        foreach ($db->query('SELECT sede, dia, abre, cierra FROM sede_horarios ORDER BY sede, dia')->fetchAll() as $h) {
            if (isset($sedes[$h['sede']])) {
                $sedes[$h['sede']]['horarios'][(int) $h['dia']] = $h['abre'] !== null
                    ? ['abre' => substr($h['abre'], 0, 5), 'cierra' => substr($h['cierra'], 0, 5)] : null;
            }
        }
        return self::$todas = $sedes;
    }

    /** Tras guardar, para que el resto de la petición no use lo leído antes. */
    public static function olvidar(): void
    {
        self::$todas = null;
    }

    public static function activas(): array
    {
        return array_filter(self::todas(), fn($s) => (int) $s['activa'] === 1);
    }

    /** Las que se administran: todas menos las eliminadas (que siguen en todas() por su historial). */
    public static function vigentes(): array
    {
        return array_filter(self::todas(), fn($s) => $s['eliminada_el'] === null);
    }

    public static function existe(mixed $codigo): bool
    {
        return is_string($codigo) && isset(self::todas()[$codigo]);
    }

    public static function activa(mixed $codigo): bool
    {
        return is_string($codigo) && isset(self::activas()[$codigo]);
    }

    /** «Nombre · dirección»: el texto de siempre en correos, reservas y pedidos. */
    public static function texto(string $codigo): string
    {
        $s = self::todas()[$codigo] ?? null;
        return $s ? "{$s['nombre']} · {$s['direccion']}" : $codigo;
    }

    /** Teléfono de contacto: el de la primera sede activa que lo tenga. */
    public static function telefono(): string
    {
        foreach (self::activas() as $s) {
            if ($s['telefono']) {
                return $s['telefono'];
            }
        }
        return self::TELEFONO_RESPALDO;
    }

    /** @return ?array{abre: string, cierra: string} null si ese día la sede no abre */
    public static function horario(string $codigo, string $dia): ?array
    {
        return self::todas()[$codigo]['horarios'][(int) date('N', strtotime($dia))] ?? null;
    }

    /**
     * Mascotas a la vez en un turno de la sede, sumando sus servicios por turnos; null = sin este límite.
     * Sin un valor elegido en el panel, una sede que es la única activa atiende de una en una.
     */
    public static function limite(string $codigo): ?int
    {
        $valor = self::todas()[$codigo]['simultaneas'] ?? null;
        if ($valor !== null) {
            return (int) $valor;
        }
        return count(self::activas()) === 1 && self::activa($codigo) ? 1 : null;
    }

    /** ¿Abre alguna sede activa ese día de la semana (1 a 7)? */
    public static function abreElDia(int $dia): bool
    {
        foreach (self::activas() as $s) {
            if (($s['horarios'][$dia] ?? null) !== null) {
                return true;
            }
        }
        return false;
    }

    /** @return array{0: string, 1: string} la hora más temprana y la más tardía entre las sedes activas */
    public static function rango(): array
    {
        $abre = '08:00';
        $cierra = '20:00';
        $primero = true;
        foreach (self::activas() as $s) {
            foreach ($s['horarios'] as $h) {
                if ($h !== null) {
                    $abre = $primero ? $h['abre'] : min($abre, $h['abre']);
                    $cierra = $primero ? $h['cierra'] : max($cierra, $h['cierra']);
                    $primero = false;
                }
            }
        }
        return [$abre, $cierra];
    }

    public static function json(array $s): array
    {
        $horarios = [];
        foreach ($s['horarios'] as $dia => $h) {
            $horarios[] = ['dia' => $dia, 'abre' => $h['abre'] ?? null, 'cierra' => $h['cierra'] ?? null];
        }
        return [
            'codigo' => $s['codigo'], 'nombre' => $s['nombre'], 'direccion' => $s['direccion'], 'texto' => "{$s['nombre']} · {$s['direccion']}",
            'telefono' => $s['telefono'], 'ubicacion' => $s['ubicacion'] ?: $s['direccion'], 'retiro' => (bool) $s['retiro'], 'horarios' => $horarios,
        ];
    }
}
