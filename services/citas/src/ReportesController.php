<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Auditoria;
use Huellitas\Db;
use Huellitas\Guard;

/**
 * Datos de los reportes en PDF (el archivo se arma en el navegador). Solo lo necesario: sin notas ni datos
 * clínicos. Cada generación queda en la bitácora con el periodo y la cantidad, nunca con los datos.
 */
final class ReportesController
{
    private const MAX_RANGO_DIAS = 366;
    private const MAX_FILAS = 5000;
    private const METODOS = ['efectivo', 'tarjeta', 'transferencia', 'otro'];

    public function citas(): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
        [$desde, $hasta] = self::rango();
        $q = Db::escritura()->prepare('SELECT c.inicio, c.estado, c.cierre_automatico, c.sede, c.cliente_nombre, m.nombre AS mascota, s.nombre AS servicio, pr.nombre AS profesional
                                         FROM citas c JOIN mascotas m ON m.id = c.mascota_id JOIN servicios s ON s.slug = c.servicio
                                         LEFT JOIN profesionales pr ON pr.servicio = c.servicio AND pr.id = c.cupo
                                        WHERE c.inicio >= ? AND c.inicio < ? + INTERVAL 1 DAY ORDER BY c.inicio LIMIT ' . (self::MAX_FILAS + 1));
        $q->execute([$desde, $hasta]);
        $filas = $q->fetchAll();
        $truncado = count($filas) > self::MAX_FILAS;
        $filas = array_slice($filas, 0, self::MAX_FILAS);
        $porEstado = array_count_values(array_map(fn($c) => $c['estado'] === 'no_asistio' && (int) $c['cierre_automatico'] ? 'por_revisar' : $c['estado'], $filas));
        $this->auditar($claims, 'citas', $desde, $hasta, count($filas));
        return [200, [
            'desde' => $desde, 'hasta' => $hasta, 'truncado' => $truncado, 'por_estado' => (object) $porEstado,
            'citas' => array_map(fn($c) => [
                'inicio' => str_replace(' ', 'T', substr($c['inicio'], 0, 16)), 'mascota' => $c['mascota'], 'cliente' => $c['cliente_nombre'],
                'servicio' => $c['servicio'], 'profesional' => $c['profesional'], 'sede' => Sedes::texto($c['sede']),
                'estado' => $c['estado'] === 'no_asistio' && (int) $c['cierre_automatico'] ? 'por_revisar' : $c['estado'],
            ], $filas),
        ]];
    }

    /** Lo cobrado (por la fecha en que se cobró) y lo anulado en el periodo, con el total por método. */
    public function caja(): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
        [$desde, $hasta] = self::rango();
        $q = Db::escritura()->prepare("SELECT c.numero, c.cliente_nombre, c.mascota_nombre, c.total, c.estado, c.metodo, c.cobrado_at, c.anulado_at, c.motivo_anulacion,
                                              (SELECT GROUP_CONCAT(l.concepto ORDER BY l.id SEPARATOR ', ') FROM cobro_lineas l WHERE l.cobro_id = c.id) AS conceptos
                                         FROM cobros c
                                        WHERE (c.estado = 'pagado' AND c.cobrado_at >= ? AND c.cobrado_at < ? + INTERVAL 1 DAY)
                                           OR (c.estado = 'anulado' AND c.anulado_at >= ? AND c.anulado_at < ? + INTERVAL 1 DAY)
                                        ORDER BY c.numero LIMIT " . (self::MAX_FILAS + 1));
        $q->execute([$desde, $hasta, $desde, $hasta]);
        $filas = $q->fetchAll();
        $truncado = count($filas) > self::MAX_FILAS;
        $filas = array_slice($filas, 0, self::MAX_FILAS);
        $porMetodo = array_fill_keys(self::METODOS, 0.0);
        foreach ($filas as $c) {
            if ($c['estado'] === 'pagado') {
                $porMetodo[$c['metodo']] = round($porMetodo[$c['metodo']] + (float) $c['total'], 2);
            }
        }
        $this->auditar($claims, 'caja', $desde, $hasta, count($filas));
        return [200, [
            'desde' => $desde, 'hasta' => $hasta, 'truncado' => $truncado, 'por_metodo' => $porMetodo, 'total' => round(array_sum($porMetodo), 2),
            'cobros' => array_map(fn($c) => [
                'recibo' => CobrosController::numeroRecibo((int) $c['numero']), 'cliente' => $c['cliente_nombre'], 'mascota' => $c['mascota_nombre'],
                'conceptos' => $c['conceptos'], 'total' => (float) $c['total'], 'estado' => $c['estado'], 'metodo' => $c['metodo'],
                'fecha' => str_replace(' ', 'T', substr($c['estado'] === 'pagado' ? $c['cobrado_at'] : $c['anulado_at'], 0, 16)),
            ], $filas),
        ]];
    }

    private function auditar(array $claims, string $reporte, string $desde, string $hasta, int $filas): void
    {
        Auditoria::registrar('REPORTE_GENERADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['reporte' => $reporte, 'desde' => $desde, 'hasta' => $hasta, 'registros' => $filas, 'formato' => 'pdf'],
        ]);
    }

    /** @return array{0: string, 1: string} */
    private static function rango(): array
    {
        $desde = self::dia($_GET['desde'] ?? null, 'desde');
        $hasta = self::dia($_GET['hasta'] ?? null, 'hasta');
        if ($hasta < $desde || (strtotime($hasta) - strtotime($desde)) / 86400 > self::MAX_RANGO_DIAS) {
            throw new ApiError(422, 'Elige un periodo de hasta un año', ['campo' => 'hasta']);
        }
        return [$desde, $hasta];
    }

    private static function dia(mixed $valor, string $campo): string
    {
        $f = is_string($valor) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $valor) : false;
        if (!$f || $f->format('Y-m-d') !== $valor) {
            throw new ApiError(422, 'Fecha no válida', ['campo' => $campo]);
        }
        return $valor;
    }
}
