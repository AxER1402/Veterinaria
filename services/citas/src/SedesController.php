<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Auditoria;
use Huellitas\Db;
use Huellitas\Guard;
use Huellitas\Http;
use Huellitas\Validar;

/** Sedes, horarios y servicios: públicos para el sitio y editables solo por el administrador. */
final class SedesController
{
    private const ACTIVAS = "('pendiente','confirmada')";
    private const TURNO_MIN = 30;
    private const CODIGOS_RESERVADOS = ['nuevo', 'nueva', 'admin', 'estado'];
    private const MAX_SIMULTANEAS = 50;

    // ---------- Sitio público ----------

    /** Lo que muestra el sitio: sedes activas, horarios, teléfono y precios. */
    public function publicas(): array
    {
        return [200, [
            'sedes' => array_values(array_map([Sedes::class, 'json'], Sedes::activas())),
            'telefono' => Sedes::telefono(),
            'servicios' => array_map(fn($s) => ['slug' => $s['slug'], 'nombre' => $s['nombre'], 'precio_desde' => (float) $s['precio_desde'], 'sede' => $s['sede']],
                Db::escritura()->query('SELECT s.slug, s.nombre, s.precio_desde, s.sede FROM servicios s JOIN sedes e ON e.codigo = s.sede AND e.activa = 1 WHERE s.activo = 1')->fetchAll()),
        ]];
    }

    /** Sedes donde se retiran pedidos (pedidos-service valida contra este mismo texto). */
    public function paraRetiro(): array
    {
        Guard::servicio(['pedidos-service']);
        $sedes = array_filter(Sedes::activas(), fn($s) => (int) $s['retiro'] === 1);
        return [200, ['sedes' => array_values(array_map(fn($s) => Sedes::texto($s['codigo']), $sedes)),
                      'ubicaciones' => (object) array_column(array_map(fn($s) => ['t' => Sedes::texto($s['codigo']), 'u' => $s['ubicacion'] ?: $s['direccion']], $sedes), 'u', 't')]];
    }

    // ---------- Panel ----------

    public function admin(): array
    {
        Guard::usuario(['admin']);
        return [200, $this->estado()];
    }

    public function crear(): array
    {
        $claims = Guard::usuario(['admin']);
        $d = Http::body();
        Validar::sinAtaques($d);
        $nueva = self::datos($d, null);
        $codigo = self::codigoNuevo($nueva['nombre']);
        $db = Db::escritura();
        $db->beginTransaction();
        try {
            $orden = (int) $db->query('SELECT COALESCE(MAX(orden), 0) + 1 FROM sedes')->fetchColumn();
            $db->prepare('INSERT INTO sedes (codigo, nombre, direccion, telefono, ubicacion, simultaneas, retiro, activa, orden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$codigo, $nueva['nombre'], $nueva['direccion'], $nueva['telefono'], $nueva['ubicacion'], $nueva['simultaneas'], $nueva['retiro'], $nueva['activa'], $orden]);
            $h = $db->prepare('INSERT INTO sede_horarios (sede, dia, abre, cierra) VALUES (?, ?, ?, ?)');
            foreach ($nueva['horarios'] as $dia => $x) {
                $h->execute([$codigo, $dia, $x ? "{$x['abre']}:00" : null, $x ? "{$x['cierra']}:00" : null]);
            }
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        Sedes::olvidar();
        Auditoria::registrar('SEDE_ACTUALIZADA', 'EXITO', Auditoria::actor($claims) + ['dato_nuevo' => ['codigo' => $codigo] + self::paraBitacora($nueva)]);
        return [201, $this->estado() + ['creada' => $codigo, 'aviso' => $this->avisoSimultaneas()]];
    }

    /**
     * Cambio de una sede. Como en el equipo: si la sede tiene citas próximas que quedarían fuera del
     * horario nuevo (o si se desactiva), se rechaza con cuántas; primero se reprograman en la agenda.
     */
    public function guardar(string $codigo): array
    {
        $claims = Guard::usuario(['admin']);
        $d = Http::body();
        Validar::sinAtaques($d);
        $actual = Sedes::vigentes()[$codigo] ?? throw new ApiError(404, 'Sede no encontrada');
        $nueva = self::datos($d, $actual);
        $db = Db::escritura();

        $db->beginTransaction();
        try {
            // Quien reserva en esta sede toma la misma fila antes de contar: los cambios no se cruzan.
            $db->prepare('SELECT codigo FROM sedes WHERE codigo = ? FOR UPDATE')->execute([$codigo]);
            if (!$nueva['activa'] && (int) $actual['activa']) {
                $this->exigirDesactivable($db, $codigo);
            }
            // Solo si cambia el horario: corregir una dirección no debe depender de las citas.
            $q = $db->prepare('SELECT c.inicio, s.modalidad FROM citas c JOIN servicios s ON s.slug = c.servicio
                                WHERE c.sede = ? AND c.estado IN ' . self::ACTIVAS . ' AND c.inicio > NOW()');
            $q->execute([$codigo]);
            $cambiaHorario = $nueva['horarios'] != self::comoDatos($actual)['horarios'];
            $fuera = !$cambiaHorario ? [] : array_filter($q->fetchAll(), function ($c) use ($nueva) {
                $h = $nueva['horarios'][(int) date('N', strtotime($c['inicio']))] ?? null;
                if ($h === null) {
                    return true;
                }
                $hora = substr($c['inicio'], 11, 5);
                return $c['modalidad'] === 'turno' && ($hora < $h['abre'] || $hora >= $h['cierra']);
            });
            if ($fuera) {
                $n = count($fuera);
                throw new ApiError(409, "Hay $n " . ($n === 1 ? 'cita próxima' : 'citas próximas') . ' fuera de ese horario. Reprográmalas primero en la agenda', ['citas' => $n]);
            }
            $db->prepare('UPDATE sedes SET nombre = ?, direccion = ?, telefono = ?, ubicacion = ?, simultaneas = ?, retiro = ?, activa = ? WHERE codigo = ?')
                ->execute([$nueva['nombre'], $nueva['direccion'], $nueva['telefono'], $nueva['ubicacion'], $nueva['simultaneas'], $nueva['retiro'], $nueva['activa'], $codigo]);
            $h = $db->prepare('INSERT INTO sede_horarios (sede, dia, abre, cierra) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE abre = VALUES(abre), cierra = VALUES(cierra)');
            foreach ($nueva['horarios'] as $dia => $x) {
                $h->execute([$codigo, $dia, $x ? "{$x['abre']}:00" : null, $x ? "{$x['cierra']}:00" : null]);
            }
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        Sedes::olvidar();
        Auditoria::registrar('SEDE_ACTUALIZADA', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => ['codigo' => $codigo] + self::paraBitacora(self::comoDatos($actual)),
            'dato_nuevo'    => ['codigo' => $codigo] + self::paraBitacora($nueva),
        ]);
        return [200, $this->estado() + ['aviso' => $this->avisoSimultaneas()]];
    }

    /**
     * Elimina una sede que ya no se usa: sale del panel y del sitio. La fila se conserva para que sus citas,
     * cobros y bloqueos anteriores sigan diciendo dónde fueron; no se puede deshacer desde el panel.
     */
    public function eliminar(string $codigo): array
    {
        $claims = Guard::usuario(['admin']);
        $actual = Sedes::vigentes()[$codigo] ?? throw new ApiError(404, 'Sede no encontrada');
        $db = Db::escritura();
        $db->beginTransaction();
        try {
            $db->prepare('SELECT codigo FROM sedes WHERE codigo = ? FOR UPDATE')->execute([$codigo]);
            if ((int) $actual['activa'] && count(Sedes::activas()) <= 1) {
                throw new ApiError(409, 'Debe quedar al menos una sede activa');
            }
            // También los servicios apagados: si se volvieran a encender, quedarían en una sede que no existe.
            $q = $db->prepare('SELECT nombre FROM servicios WHERE sede = ?');
            $q->execute([$codigo]);
            $servicios = $q->fetchAll(\PDO::FETCH_COLUMN);
            if ($servicios) {
                throw new ApiError(409, 'Primero mueve sus servicios a otra sede: ' . implode(', ', $servicios), ['servicios' => $servicios]);
            }
            $q = $db->prepare('SELECT COUNT(*) FROM citas WHERE sede = ? AND estado IN ' . self::ACTIVAS . ' AND inicio > NOW()');
            $q->execute([$codigo]);
            $n = (int) $q->fetchColumn();
            if ($n > 0) {
                throw new ApiError(409, "Tiene $n " . ($n === 1 ? 'cita próxima' : 'citas próximas') . '. Atiéndelas o cancélalas antes de eliminarla', ['citas' => $n]);
            }
            $db->prepare('UPDATE sedes SET activa = 0, retiro = 0, eliminada_el = NOW() WHERE codigo = ?')->execute([$codigo]);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        Sedes::olvidar();
        Auditoria::registrar('SEDE_ELIMINADA', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => ['codigo' => $codigo, 'nombre' => $actual['nombre'], 'direccion' => $actual['direccion'], 'activa' => (bool) $actual['activa']],
            'dato_nuevo'    => ['codigo' => $codigo, 'eliminada' => true],
        ]);
        return [200, $this->estado() + ['aviso' => $this->avisoSimultaneas()]];
    }

    /** Precio, sede y estado de un servicio. Mover o apagar uno con citas próximas se rechaza con cuántas. */
    public function guardarServicio(string $slug): array
    {
        $claims = Guard::usuario(['admin']);
        $d = Http::body();
        Validar::sinAtaques($d);
        $db = Db::escritura();
        $q = $db->prepare('SELECT * FROM servicios WHERE slug = ?');
        $q->execute([$slug]);
        $actual = $q->fetch() ?: throw new ApiError(404, 'Servicio no encontrado');

        $precio = $d['precio_desde'] ?? $actual['precio_desde'];
        if (!is_numeric($precio) || (float) $precio < 0.01 || (float) $precio > 99999) {
            throw new ApiError(422, 'Precio no válido', ['campo' => 'precio_desde']);
        }
        $precio = round((float) $precio, 2);
        $sede = $d['sede'] ?? $actual['sede'];
        if (!Sedes::activa($sede)) {
            throw new ApiError(422, 'Elige una sede activa', ['campo' => 'sede']);
        }
        $activo = $d['activo'] ?? (bool) $actual['activo'];
        if (!is_bool($activo)) {
            throw new ApiError(422, 'Indica si el servicio está activo', ['campo' => 'activo']);
        }
        if ($sede !== $actual['sede'] || (!$activo && (int) $actual['activo'])) {
            $q = $db->prepare('SELECT COUNT(*) FROM citas WHERE servicio = ? AND estado IN ' . self::ACTIVAS . ' AND inicio > NOW()');
            $q->execute([$slug]);
            $n = (int) $q->fetchColumn();
            if ($n > 0) {
                throw new ApiError(409, "Este servicio tiene $n " . ($n === 1 ? 'cita próxima' : 'citas próximas') . ' en su sede actual. Atiéndelas o cancélalas antes de moverlo o apagarlo', ['citas' => $n]);
            }
        }
        $db->prepare('UPDATE servicios SET precio_desde = ?, sede = ?, activo = ? WHERE slug = ?')->execute([$precio, $sede, (int) $activo, $slug]);
        Auditoria::registrar('SERVICIO_ACTUALIZADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => ['servicio' => $slug, 'precio_desde' => (float) $actual['precio_desde'], 'sede' => $actual['sede'], 'activo' => (bool) $actual['activo']],
            'dato_nuevo'    => ['servicio' => $slug, 'precio_desde' => $precio, 'sede' => $sede, 'activo' => $activo],
        ]);
        return [200, $this->estado()];
    }

    private function exigirDesactivable(\PDO $db, string $codigo): void
    {
        if (count(Sedes::activas()) <= 1) {
            throw new ApiError(409, 'Debe quedar al menos una sede activa');
        }
        $q = $db->prepare('SELECT nombre FROM servicios WHERE sede = ? AND activo = 1');
        $q->execute([$codigo]);
        $servicios = $q->fetchAll(\PDO::FETCH_COLUMN);
        if ($servicios) {
            throw new ApiError(409, 'Primero mueve o apaga sus servicios: ' . implode(', ', $servicios), ['servicios' => $servicios]);
        }
        $q = $db->prepare('SELECT COUNT(*) FROM citas WHERE sede = ? AND estado IN ' . self::ACTIVAS . ' AND inicio > NOW()');
        $q->execute([$codigo]);
        $n = (int) $q->fetchColumn();
        if ($n > 0) {
            throw new ApiError(409, "Tiene $n " . ($n === 1 ? 'cita próxima' : 'citas próximas') . '. Atiéndelas o cancélalas antes de desactivarla', ['citas' => $n]);
        }
    }

    /** Si el límite nuevo ya se supera en turnos futuros, se avisa: las citas existentes no se tocan. */
    private function avisoSimultaneas(): ?string
    {
        $db = Db::escritura();
        $partes = [];
        foreach (Sedes::activas() as $codigo => $s) {
            $limite = Sedes::limite($codigo);
            if ($limite === null) {
                continue;
            }
            $q = $db->prepare("SELECT COUNT(*) FROM (SELECT c.inicio FROM citas c JOIN servicios v ON v.slug = c.servicio
                                 WHERE c.sede = ? AND v.modalidad = 'turno' AND c.estado IN " . self::ACTIVAS . ' AND c.inicio > NOW()
                                 GROUP BY c.inicio HAVING COUNT(*) > ?) x');
            $q->execute([$codigo, $limite]);
            $n = (int) $q->fetchColumn();
            if ($n > 0) {
                $partes[] = "{$s['nombre']}: $n " . ($n === 1 ? 'horario ya tiene' : 'horarios ya tienen') . " más de $limite a la vez";
            }
        }
        return $partes ? implode('. ', $partes) . '. Esas citas se conservan; reprográmalas si hace falta.' : null;
    }

    private function estado(): array
    {
        $db = Db::escritura();
        $conteo = array_column($db->query('SELECT sede, COUNT(*) AS n FROM citas WHERE estado IN ' . self::ACTIVAS . ' AND inicio > NOW() GROUP BY sede')->fetchAll(), 'n', 'sede');
        $sedes = array_values(array_map(fn($s) => Sedes::json($s) + [
            'activa' => (bool) $s['activa'],
            'simultaneas' => $s['simultaneas'] !== null ? (int) $s['simultaneas'] : null,
            'limite' => Sedes::limite($s['codigo']),
            'citas_proximas' => (int) ($conteo[$s['codigo']] ?? 0),
        ], Sedes::vigentes()));
        $servicios = array_map(fn($s) => [
            'slug' => $s['slug'], 'nombre' => $s['nombre'], 'precio_desde' => (float) $s['precio_desde'], 'sede' => $s['sede'],
            'modalidad' => $s['modalidad'], 'activo' => (bool) $s['activo'], 'citas_proximas' => (int) $s['proximas'],
        ], $db->query('SELECT s.*, (SELECT COUNT(*) FROM citas c WHERE c.servicio = s.slug AND c.estado IN ' . self::ACTIVAS . ' AND c.inicio > NOW()) AS proximas
                         FROM servicios s ORDER BY s.nombre')->fetchAll());
        return ['sedes' => $sedes, 'servicios' => $servicios];
    }

    /** Valida los datos; lo que no venga se conserva de la sede actual. */
    private static function datos(array $d, ?array $actual): array
    {
        $base = $actual ? self::comoDatos($actual) : ['nombre' => null, 'direccion' => null, 'telefono' => null, 'ubicacion' => null, 'simultaneas' => null, 'retiro' => 1, 'activa' => 1, 'horarios' => self::horarioPorOmision()];
        $texto = fn(string $campo, int $min, int $max) => array_key_exists($campo, $d) || $base[$campo] === null ? Validar::texto($d, $campo, $min, $max) : $base[$campo];
        $telefono = array_key_exists('telefono', $d) ? ($d['telefono'] === '' || $d['telefono'] === null ? null : $d['telefono']) : $base['telefono'];
        if ($telefono !== null && (!is_string($telefono) || !preg_match('/^\+?[0-9 ()\-]{7,20}$/', $telefono))) {
            throw new ApiError(422, 'Teléfono no válido', ['campo' => 'telefono']);
        }
        $ubicacion = array_key_exists('ubicacion', $d) ? ($d['ubicacion'] === '' || $d['ubicacion'] === null ? null : Validar::texto($d, 'ubicacion', 3, 200)) : $base['ubicacion'];
        $simultaneas = array_key_exists('simultaneas', $d) ? $d['simultaneas'] : $base['simultaneas'];
        if ($simultaneas === '') {
            $simultaneas = null;
        }
        if ($simultaneas !== null && (!is_int($simultaneas) || $simultaneas < 1 || $simultaneas > self::MAX_SIMULTANEAS)) {
            throw new ApiError(422, 'Mascotas a la vez: de 1 a ' . self::MAX_SIMULTANEAS, ['campo' => 'simultaneas']);
        }
        foreach (['retiro', 'activa'] as $campo) {
            if (isset($d[$campo]) && !is_bool($d[$campo])) {
                throw new ApiError(422, "Valor no válido en $campo", ['campo' => $campo]);
            }
        }
        return [
            'nombre' => $texto('nombre', 3, 80), 'direccion' => $texto('direccion', 5, 160), 'telefono' => $telefono, 'ubicacion' => $ubicacion,
            'simultaneas' => $simultaneas,
            'retiro' => isset($d['retiro']) ? (int) $d['retiro'] : (int) $base['retiro'],
            'activa' => isset($d['activa']) ? (int) $d['activa'] : (int) $base['activa'],
            'horarios' => array_key_exists('horarios', $d) ? self::horarios($d['horarios']) : $base['horarios'],
        ];
    }

    private static function comoDatos(array $s): array
    {
        return ['nombre' => $s['nombre'], 'direccion' => $s['direccion'], 'telefono' => $s['telefono'], 'ubicacion' => $s['ubicacion'],
                'simultaneas' => $s['simultaneas'] !== null ? (int) $s['simultaneas'] : null, 'retiro' => (int) $s['retiro'], 'activa' => (int) $s['activa'],
                'horarios' => $s['horarios'] + self::horarioCerrado()];
    }

    private static function paraBitacora(array $datos): array
    {
        return array_diff_key($datos, ['horarios' => 1]) + ['horario' => array_map(fn($h) => $h ? "{$h['abre']}-{$h['cierra']}" : 'cerrado', $datos['horarios'])];
    }

    private static function horarioCerrado(): array
    {
        return array_fill(1, 7, null);
    }

    private static function horarioPorOmision(): array
    {
        return array_fill(1, 6, ['abre' => '08:00', 'cierra' => '20:00']) + [7 => null];
    }

    /** Los 7 días con su apertura y cierre, o abre vacío si ese día no abre. Al menos uno abierto. */
    private static function horarios(mixed $lista): array
    {
        if (!is_array($lista) || !array_is_list($lista)) {
            throw new ApiError(422, 'Horario no válido', ['campo' => 'horarios']);
        }
        $r = self::horarioCerrado();
        foreach ($lista as $h) {
            $dia = is_array($h) ? ($h['dia'] ?? null) : null;
            if (!is_int($dia) || $dia < 1 || $dia > 7) {
                throw new ApiError(422, 'Horario no válido: día de 1 a 7', ['campo' => 'horarios']);
            }
            if (($h['abre'] ?? null) === null || ($h['abre'] ?? '') === '') {
                continue;
            }
            $abre = self::hora($h['abre']);
            $cierra = self::hora($h['cierra'] ?? null);
            if ($cierra <= $abre) {
                throw new ApiError(422, 'La hora de cierre debe ser después de la de apertura', ['campo' => 'horarios']);
            }
            $r[$dia] = ['abre' => $abre, 'cierra' => $cierra];
        }
        if (!array_filter($r)) {
            throw new ApiError(422, 'La sede debe abrir al menos un día', ['campo' => 'horarios']);
        }
        return $r;
    }

    private static function hora(mixed $valor): string
    {
        if (is_string($valor) && preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/', $valor, $m) && ((int) $m[2]) % self::TURNO_MIN === 0) {
            return $valor;
        }
        throw new ApiError(422, 'Hora no válida: usa intervalos de 30 minutos', ['campo' => 'horarios']);
    }

    private static function codigoNuevo(string $nombre): string
    {
        $base = strtolower(trim(preg_replace('/[^a-zA-Z0-9]+/', '-', strtr($nombre, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ñ' => 'n', 'Á' => 'a', 'É' => 'e', 'Í' => 'i', 'Ó' => 'o', 'Ú' => 'u', 'Ñ' => 'n'])), '-'));
        $base = substr($base, 0, 16) ?: 'sede';
        $base = trim($base, '-');
        if (in_array($base, self::CODIGOS_RESERVADOS, true)) {
            $base = "sede-$base";
        }
        $codigo = $base;
        for ($n = 2; Sedes::existe($codigo); $n++) {
            $codigo = "$base-$n";
        }
        return $codigo;
    }
}
