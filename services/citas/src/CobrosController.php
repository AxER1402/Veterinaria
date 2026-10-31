<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Auditoria;
use Huellitas\Db;
use Huellitas\Env;
use Huellitas\Guard;
use Huellitas\Http;
use Huellitas\Interno;
use Huellitas\Jwt;
use Huellitas\Validar;

/**
 * Cobro en mostrador de consultas y servicios, con su recibo. Los conceptos los escribe el personal y no
 * van a la bitácora (pueden decir algo clínico). Un cobro pagado no cambia: se anula con su motivo.
 * No es una factura de la SAT: eso necesita un certificador FEL contratado.
 */
final class CobrosController
{
    private const METODOS = ['efectivo', 'tarjeta', 'transferencia', 'otro'];
    private const MAX_LINEAS = 30;
    private const MAX_RANGO_DIAS = 366;

    /** Cobros de un rango con el total recibido por método (la caja). */
    public function lista(): array
    {
        Guard::usuario(Guard::CLINICA);
        $desde = self::dia($_GET['desde'] ?? date('Y-m-d'), 'desde');
        $hasta = self::dia($_GET['hasta'] ?? $desde, 'hasta');
        if ($hasta < $desde || (strtotime($hasta) - strtotime($desde)) / 86400 > self::MAX_RANGO_DIAS) {
            throw new ApiError(422, 'Rango de fechas no válido', ['campo' => 'hasta']);
        }
        $q = Db::escritura()->prepare('SELECT * FROM cobros
                                        WHERE (cobrado_at >= ? AND cobrado_at < ? + INTERVAL 1 DAY)
                                           OR (anulado_at >= ? AND anulado_at < ? + INTERVAL 1 DAY)
                                           OR estado = \'pendiente\'
                                           OR (created_at >= ? AND created_at < ? + INTERVAL 1 DAY)
                                        ORDER BY numero DESC LIMIT 500');
        $q->execute([$desde, $hasta, $desde, $hasta, $desde, $hasta]);
        $filas = $q->fetchAll();
        $porMetodo = array_fill_keys(self::METODOS, 0.0);
        foreach ($filas as $c) {
            if ($c['estado'] === 'pagado' && substr($c['cobrado_at'], 0, 10) >= $desde && substr($c['cobrado_at'], 0, 10) <= $hasta) {
                $porMetodo[$c['metodo']] = round($porMetodo[$c['metodo']] + (float) $c['total'], 2);
            }
        }
        return [200, ['desde' => $desde, 'hasta' => $hasta, 'cobros' => array_map([$this, 'json'], $this->conLineas($filas)),
                      'por_metodo' => $porMetodo, 'total' => round(array_sum($porMetodo), 2),
                      'pendiente' => round(array_sum(array_map(fn($c) => $c['estado'] === 'pendiente' ? (float) $c['total'] : 0, $filas)), 2)]];
    }

    /** Cobros de una mascota o de un cliente (sus fichas en el panel). */
    public function de(): array
    {
        Guard::usuario(Guard::CLINICA);
        $mascota = $_GET['mascota'] ?? null;
        $cliente = $_GET['cliente'] ?? null;
        if (is_string($mascota) && preg_match('/^[0-9a-f\-]{36}$/', $mascota)) {
            $q = Db::escritura()->prepare('SELECT * FROM cobros WHERE mascota_id = ? ORDER BY numero DESC LIMIT 200');
            $q->execute([$mascota]);
        } elseif (is_string($cliente) && ctype_digit($cliente)) {
            $q = Db::escritura()->prepare('SELECT * FROM cobros WHERE id_cliente = ? ORDER BY numero DESC LIMIT 200');
            $q->execute([(int) $cliente]);
        } else {
            throw new ApiError(422, 'Indica la mascota o el cliente', ['campo' => 'mascota']);
        }
        return [200, ['cobros' => array_map([$this, 'json'], $this->conLineas($q->fetchAll()))]];
    }

    public function ver(string $id): array
    {
        Guard::usuario(Guard::CLINICA);
        $c = $this->porId($id) ?? throw new ApiError(404, 'Cobro no encontrado');
        return [200, ['cobro' => $this->json($this->conLineas([$c])[0])]];
    }

    /** Recibos del cliente que inició sesión. */
    public function mios(): array
    {
        $claims = Guard::usuario(['cliente', ...Guard::CLINICA]);
        $q = Db::escritura()->prepare("SELECT * FROM cobros WHERE id_cliente = ? AND estado <> 'anulado' ORDER BY numero DESC LIMIT 100");
        $q->execute([(int) $claims['sub']]);
        return [200, ['cobros' => array_map([$this, 'json'], $this->conLineas($q->fetchAll()))]];
    }

    /** Crea el cobro de una cita o de una mascota (consulta sin cita). Con «pago» queda pagado en el mismo paso. */
    public function crear(): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
        $d = Http::body();
        Validar::sinAtaques($d);
        $lineas = self::lineas($d['lineas'] ?? null);
        $total = round(array_sum(array_column($lineas, 'subtotal')), 2);
        if ($total <= 0 || $total > 999999) {
            throw new ApiError(422, 'El total debe ser mayor que cero', ['campo' => 'lineas']);
        }
        $origen = $this->origen($d);
        $pago = isset($d['pago']) ? self::pago($d['pago']) : null;

        $id = Jwt::uuid();
        $db = Db::escritura();
        $db->beginTransaction();
        try {
            try {
                $db->prepare('INSERT INTO cobros (id, cita_id, mascota_id, id_cliente, cliente_nombre, cliente_email, mascota_nombre, sede, total, estado, metodo, referencia,
                                                  creado_por, creado_email, cobrado_por, cobrado_email, cobrado_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    ->execute([$id, $origen['cita_id'], $origen['mascota_id'], $origen['id_cliente'], $origen['cliente_nombre'], $origen['cliente_email'],
                               $origen['mascota_nombre'], $origen['sede'], $total, $pago ? 'pagado' : 'pendiente', $pago['metodo'] ?? null, $pago['referencia'] ?? null,
                               (int) $claims['sub'], $claims['email'], $pago ? (int) $claims['sub'] : null, $pago ? $claims['email'] : null, $pago ? date('Y-m-d H:i:s') : null]);
            } catch (\PDOException $e) {
                if (($e->errorInfo[1] ?? null) === 1062) {
                    throw new ApiError(409, 'Esta cita ya tiene un cobro. Anúlalo si necesitas hacer otro');
                }
                throw $e;
            }
            $ins = $db->prepare('INSERT INTO cobro_lineas (cobro_id, concepto, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)');
            foreach ($lineas as $l) {
                $ins->execute([$id, $l['concepto'], $l['cantidad'], $l['precio_unitario'], $l['subtotal']]);
            }
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        Auditoria::registrar('COBRO_REGISTRADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['cobro_id' => $id, 'cita_id' => $origen['cita_id'], 'cliente_id' => $origen['id_cliente'], 'total' => $total, 'lineas' => count($lineas),
                             'estado' => $pago ? 'pagado' : 'pendiente', 'metodo' => $pago['metodo'] ?? null],
        ]);
        $cobro = $this->porId($id);
        if ($pago) {
            $this->avisarRecibo($cobro);
        }
        return [201, ['cobro' => $this->json($this->conLineas([$cobro])[0])]];
    }

    public function pagar(string $id): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
        $d = Http::body();
        Validar::sinAtaques($d);
        $pago = self::pago($d);
        $this->mover($id, 'pendiente', 'Este cobro ya no está pendiente', "estado = 'pagado', metodo = ?, referencia = ?, cobrado_por = ?, cobrado_email = ?, cobrado_at = NOW()",
            [$pago['metodo'], $pago['referencia'], (int) $claims['sub'], $claims['email']]);
        $cobro = $this->porId($id);
        Auditoria::registrar('COBRO_PAGADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => ['cobro_id' => $id, 'estado' => 'pendiente'],
            'dato_nuevo'    => ['cobro_id' => $id, 'estado' => 'pagado', 'metodo' => $pago['metodo'], 'total' => (float) $cobro['total']],
        ]);
        $this->avisarRecibo($cobro);
        return [200, ['cobro' => $this->json($this->conLineas([$cobro])[0])]];
    }

    /** Un cobro ya pagado solo lo anula el administrador; uno pendiente, cualquiera de la clínica. */
    public function anular(string $id): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
        $d = Http::body();
        Validar::sinAtaques($d);
        $motivo = Validar::texto($d, 'motivo', 3, 200);
        $actual = $this->porId($id) ?? throw new ApiError(404, 'Cobro no encontrado');
        if ($actual['estado'] === 'pagado' && $claims['rol'] !== 'admin') {
            Auditoria::registrar('ACCESO_DENEGADO', 'FALLO', Auditoria::actor($claims) + ['dato_nuevo' => ['recurso' => 'cobro', 'cobro_id' => $id, 'motivo' => 'anular un cobro pagado requiere administración']]);
            throw new ApiError(403, 'Solo administración puede anular un cobro ya pagado');
        }
        $this->mover($id, $actual['estado'], 'Este cobro cambió mientras tanto, recarga', "estado = 'anulado', motivo_anulacion = ?, anulado_por = ?, anulado_at = NOW()", [$motivo, (int) $claims['sub']], ['pendiente', 'pagado']);
        Auditoria::registrar('COBRO_ANULADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => ['cobro_id' => $id, 'estado' => $actual['estado'], 'total' => (float) $actual['total']],
            'dato_nuevo'    => ['cobro_id' => $id, 'estado' => 'anulado', 'motivo' => $motivo],
        ]);
        return [200, ['cobro' => $this->json($this->conLineas([$this->porId($id)])[0])]];
    }

    /** Cambio con bloqueo de fila: dos personas no cobran ni anulan lo mismo a la vez. */
    private function mover(string $id, string $esperado, string $error, string $set, array $params, ?array $validos = null): void
    {
        $db = Db::escritura();
        $db->beginTransaction();
        try {
            $q = $db->prepare('SELECT estado FROM cobros WHERE id = ? FOR UPDATE');
            $q->execute([$id]);
            $estado = $q->fetchColumn();
            if ($estado === false) {
                throw new ApiError(404, 'Cobro no encontrado');
            }
            if ($estado !== $esperado || ($validos !== null && !in_array($estado, $validos, true))) {
                throw new ApiError(409, $error);
            }
            $db->prepare("UPDATE cobros SET $set WHERE id = ?")->execute([...$params, $id]);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
    }

    /** De dónde sale el cobro: cita o mascota, y a quién se le cobra. */
    private function origen(array $d): array
    {
        $db = Db::escritura();
        if (is_string($d['cita_id'] ?? null) && preg_match('/^[0-9a-f\-]{36}$/', $d['cita_id'])) {
            $q = $db->prepare('SELECT c.id, c.mascota_id, c.id_cliente, c.cliente_nombre, c.cliente_email, c.sede, c.estado, m.nombre AS mascota
                                 FROM citas c JOIN mascotas m ON m.id = c.mascota_id WHERE c.id = ?');
            $q->execute([$d['cita_id']]);
            $c = $q->fetch() ?: throw new ApiError(404, 'Cita no encontrada');
            if (in_array($c['estado'], ['cancelada', 'no_asistio'], true)) {
                throw new ApiError(409, 'Una cita cancelada o a la que no asistieron no se cobra');
            }
            return ['cita_id' => $c['id'], 'mascota_id' => $c['mascota_id'], 'id_cliente' => (int) $c['id_cliente'], 'cliente_nombre' => $c['cliente_nombre'],
                    'cliente_email' => $c['cliente_email'], 'mascota_nombre' => $c['mascota'], 'sede' => $c['sede']];
        }
        if (is_string($d['mascota_id'] ?? null) && preg_match('/^[0-9a-f\-]{36}$/', $d['mascota_id'])) {
            $q = $db->prepare('SELECT m.id, m.nombre, m.id_cliente,
                                      (SELECT u.cliente_nombre FROM citas u WHERE u.id_cliente = m.id_cliente ORDER BY u.created_at DESC LIMIT 1) AS cliente_nombre,
                                      (SELECT u.cliente_email FROM citas u WHERE u.id_cliente = m.id_cliente ORDER BY u.created_at DESC LIMIT 1) AS cliente_email
                                 FROM mascotas m WHERE m.id = ?');
            $q->execute([$d['mascota_id']]);
            $m = $q->fetch() ?: throw new ApiError(404, 'Mascota no encontrada');
            $nombre = isset($d['cliente_nombre']) && $d['cliente_nombre'] !== '' ? Validar::texto($d, 'cliente_nombre', 2, 100) : $m['cliente_nombre'];
            if (!$nombre) {
                throw new ApiError(422, 'Indica a nombre de quién va el recibo', ['campo' => 'cliente_nombre']);
            }
            return ['cita_id' => null, 'mascota_id' => $m['id'], 'id_cliente' => (int) $m['id_cliente'], 'cliente_nombre' => $nombre,
                    'cliente_email' => $m['cliente_email'], 'mascota_nombre' => $m['nombre'], 'sede' => array_key_first(Sedes::activas())];
        }
        throw new ApiError(422, 'Indica la cita o la mascota', ['campo' => 'cita_id']);
    }

    private static function pago(mixed $d): array
    {
        if (!is_array($d) || !in_array($d['metodo'] ?? null, self::METODOS, true)) {
            throw new ApiError(422, 'Elige cómo se pagó', ['campo' => 'metodo']);
        }
        return ['metodo' => $d['metodo'], 'referencia' => isset($d['referencia']) && $d['referencia'] !== '' ? Validar::texto($d, 'referencia', 1, 60) : null];
    }

    /** El servidor calcula los subtotales: nunca se confía en los que mande el navegador. */
    private static function lineas(mixed $lista): array
    {
        if (!is_array($lista) || !array_is_list($lista) || !$lista || count($lista) > self::MAX_LINEAS) {
            throw new ApiError(422, 'Agrega de 1 a ' . self::MAX_LINEAS . ' conceptos', ['campo' => 'lineas']);
        }
        return array_map(function ($l) {
            if (!is_array($l)) {
                throw new ApiError(422, 'Concepto no válido', ['campo' => 'lineas']);
            }
            $cantidad = $l['cantidad'] ?? 1;
            $precio = $l['precio_unitario'] ?? null;
            if (!is_int($cantidad) || $cantidad < 1 || $cantidad > 999) {
                throw new ApiError(422, 'Cantidad no válida', ['campo' => 'lineas']);
            }
            if (!is_numeric($precio) || (float) $precio < 0 || (float) $precio > 99999) {
                throw new ApiError(422, 'Precio no válido', ['campo' => 'lineas']);
            }
            $precio = round((float) $precio, 2);
            return ['concepto' => Validar::texto($l, 'concepto', 2, 120), 'cantidad' => $cantidad, 'precio_unitario' => $precio, 'subtotal' => round($precio * $cantidad, 2)];
        }, $lista);
    }

    private static function dia(mixed $valor, string $campo): string
    {
        $f = is_string($valor) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $valor) : false;
        if (!$f || $f->format('Y-m-d') !== $valor) {
            throw new ApiError(422, 'Fecha no válida', ['campo' => $campo]);
        }
        return $valor;
    }

    private function porId(string $id): ?array
    {
        if (!preg_match('/^[0-9a-f\-]{36}$/', $id)) {
            return null;
        }
        $q = Db::escritura()->prepare('SELECT * FROM cobros WHERE id = ?');
        $q->execute([$id]);
        return $q->fetch() ?: null;
    }

    private function conLineas(array $cobros): array
    {
        if (!$cobros) {
            return [];
        }
        $q = Db::escritura()->prepare('SELECT * FROM cobro_lineas WHERE cobro_id IN (' . implode(',', array_fill(0, count($cobros), '?')) . ') ORDER BY id');
        $q->execute(array_column($cobros, 'id'));
        $por = [];
        foreach ($q->fetchAll() as $l) {
            $por[$l['cobro_id']][] = ['concepto' => $l['concepto'], 'cantidad' => (int) $l['cantidad'], 'precio_unitario' => (float) $l['precio_unitario'], 'subtotal' => (float) $l['subtotal']];
        }
        return array_map(fn($c) => $c + ['lineas' => $por[$c['id']] ?? []], $cobros);
    }

    private function json(array $c): array
    {
        return [
            'id' => $c['id'], 'numero' => (int) $c['numero'], 'recibo' => self::numeroRecibo((int) $c['numero']), 'cita_id' => $c['cita_id'], 'mascota_id' => $c['mascota_id'],
            'cliente' => ['id' => (int) $c['id_cliente'], 'nombre' => $c['cliente_nombre'], 'email' => $c['cliente_email']],
            'mascota' => $c['mascota_nombre'], 'sede' => $c['sede'] ? Sedes::texto($c['sede']) : null,
            'total' => (float) $c['total'], 'estado' => $c['estado'], 'metodo' => $c['metodo'], 'referencia' => $c['referencia'], 'motivo_anulacion' => $c['motivo_anulacion'],
            'fecha' => str_replace(' ', 'T', substr($c['created_at'], 0, 16)),
            'cobrado_at' => $c['cobrado_at'] !== null ? str_replace(' ', 'T', substr($c['cobrado_at'], 0, 16)) : null,
            'cobrado_por' => $c['cobrado_email'],
            'lineas' => $c['lineas'] ?? [],
        ];
    }

    public static function numeroRecibo(int $numero): string
    {
        return sprintf('R-%06d', $numero);
    }

    /** El correo no bloquea: si falla, el cobro sigue y el recibo se puede imprimir. */
    private function avisarRecibo(array $c): void
    {
        if (!$c['cliente_email']) {
            return;
        }
        Interno::post(rtrim(Env::get('NOTIFICACIONES_URL', 'http://notificaciones-service:8085'), '/') . '/internal/notificaciones/recibo', [
            'cobro_id' => $c['id'], 'recibo' => self::numeroRecibo((int) $c['numero']), 'total' => number_format((float) $c['total'], 2, '.', ''),
            'mascota' => $c['mascota_nombre'] ?? '', 'cliente_nombre' => $c['cliente_nombre'], 'cliente_email' => $c['cliente_email'],
            'sede' => $c['sede'] ? Sedes::texto($c['sede']) : '',
        ], 12);
    }
}
