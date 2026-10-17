<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Auditoria;
use Huellitas\Db;
use Huellitas\Env;
use Huellitas\Guard;
use Huellitas\Http;
use Huellitas\Jwt;
use Huellitas\Validar;

/**
 * Mascotas y citas. A01: el dueño sale siempre del JWT; un recurso ajeno responde 404 (como si no
 * existiera) y queda como ACCESO_DENEGADO en la bitácora. La doble reserva la impide la BD
 * (índice único por sede, hora y cupo), no una consulta previa que otra petición podría ganar.
 */
final class CitasController
{
    public const SEDES = [
        'centro' => 'Clínica veterinaria y peluquería · Av. Principal 954, Centro',
        'norte'  => 'Guardería y hospedaje – Norte · Calle Los Robles 864, Zona Norte',
        'sur'    => 'Paseadores y cuidadores – Sur · Blvd. Ribereño 180, Zona Sur',
    ];
    private const APERTURA = 8;          // lunes a sábado, 8:00–20:00
    private const CIERRE = 20;
    private const TURNO_MIN = 30;
    private const ANTICIPACION_MIN = 60; // no se reserva un turno que empieza en menos de 1 h
    private const MAX_DIAS = 60;
    private const CANCELAR_HORAS = 2;
    private const MAX_ACTIVAS = 5;       // D de STRIDE: un cliente no puede acaparar la agenda
    private const ESPECIES = ['perro', 'gato', 'otro'];

    /** Transiciones que puede hacer el admin. La cancelación del cliente va por /cancelar. */
    private const TRANSICIONES = [
        'pendiente'  => ['confirmada', 'cancelada', 'no_asistio', 'atendida'],
        'confirmada' => ['atendida', 'no_asistio', 'cancelada'],
        'atendida'   => [],
        'no_asistio' => [],
        'cancelada'  => [],
    ];

    // ---------- Públicos ----------

    public function servicios(): array
    {
        $filas = Db::lectura()->query('SELECT slug, nombre, sede, precio_desde FROM servicios WHERE activo = 1 ORDER BY sede, nombre')->fetchAll();
        return [200, ['servicios' => array_map(fn($s) => [
            'slug' => $s['slug'], 'nombre' => $s['nombre'], 'precio_desde' => (float) $s['precio_desde'],
            'sede' => ['codigo' => $s['sede'], 'nombre' => self::SEDES[$s['sede']]],
        ], $filas)]];
    }

    /** Turnos de un día con los cupos libres. Se lee de la réplica: no carga al maestro. */
    public function disponibilidad(): array
    {
        $servicio = $this->servicio($_GET['servicio'] ?? null);
        $fecha = self::fecha($_GET['fecha'] ?? null);
        return [200, [
            'servicio' => $servicio['slug'],
            'sede'     => ['codigo' => $servicio['sede'], 'nombre' => self::SEDES[$servicio['sede']]],
            'fecha'    => $fecha->format('Y-m-d'),
            'turnos'   => $this->turnos($servicio['sede'], $fecha, Db::lectura()),
        ]];
    }

    // ---------- Mascotas del cliente ----------

    public function mascotas(): array
    {
        $claims = Guard::usuario(['cliente', 'admin']);
        $q = Db::escritura()->prepare('SELECT * FROM mascotas WHERE id_cliente = ? AND activa = 1 ORDER BY created_at');
        $q->execute([(int) $claims['sub']]);
        return [200, ['mascotas' => array_map(fn($m) => self::mascotaJson($m), $q->fetchAll())]];
    }

    public function crearMascota(): array
    {
        $claims = Guard::usuario(['cliente', 'admin']);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $m = self::datosMascota($datos);
        $id = Jwt::uuid();
        Db::escritura()->prepare('INSERT INTO mascotas (id, id_cliente, nombre, especie, raza, sexo, fecha_nacimiento, peso_kg, notas)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, (int) $claims['sub'], $m['nombre'], $m['especie'], $m['raza'], $m['sexo'], $m['fecha_nacimiento'], $m['peso_kg'], $m['notas']]);

        Auditoria::registrar('MASCOTA_REGISTRADA', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['mascota_id' => $id, 'nombre' => $m['nombre'], 'especie' => $m['especie']],
        ]);
        return [201, ['mascota' => self::mascotaJson($this->mascotaPorId($id))]];
    }

    public function actualizarMascota(string $id): array
    {
        $claims = Guard::usuario(['cliente', 'admin']);
        $actual = $this->mascotaPropia($id, $claims);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $m = self::datosMascota($datos + self::mascotaJson($actual));
        Db::escritura()->prepare('UPDATE mascotas SET nombre = ?, especie = ?, raza = ?, sexo = ?, fecha_nacimiento = ?, peso_kg = ?, notas = ? WHERE id = ?')
            ->execute([$m['nombre'], $m['especie'], $m['raza'], $m['sexo'], $m['fecha_nacimiento'], $m['peso_kg'], $m['notas'], $id]);

        $antes = array_intersect_key(self::mascotaJson($actual), $m);
        $cambios = array_filter($m, fn($v, $k) => $antes[$k] != $v, ARRAY_FILTER_USE_BOTH);
        if ($cambios) {
            Auditoria::registrar('MASCOTA_ACTUALIZADA', 'EXITO', Auditoria::actor($claims) + [
                'dato_anterior' => ['mascota_id' => $id] + array_intersect_key($antes, $cambios),
                'dato_nuevo'    => ['mascota_id' => $id] + $cambios,
            ]);
        }
        return [200, ['mascota' => self::mascotaJson($this->mascotaPorId($id))]];
    }

    /** No se borra: queda inactiva (sus citas pasadas siguen teniendo a quién apuntar). */
    public function desactivarMascota(string $id): array
    {
        $claims = Guard::usuario(['cliente', 'admin']);
        $this->mascotaPropia($id, $claims);
        $db = Db::escritura();
        $q = $db->prepare("SELECT COUNT(*) FROM citas WHERE mascota_id = ? AND estado IN ('pendiente','confirmada') AND inicio > NOW()");
        $q->execute([$id]);
        if ((int) $q->fetchColumn() > 0) {
            throw new ApiError(409, 'Cancela primero sus citas próximas');
        }
        $db->prepare('UPDATE mascotas SET activa = 0 WHERE id = ?')->execute([$id]);
        Auditoria::registrar('MASCOTA_ACTUALIZADA', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => ['mascota_id' => $id, 'activa' => true],
            'dato_nuevo'    => ['mascota_id' => $id, 'activa' => false],
        ]);
        return [200, ['ok' => true]];
    }

    // ---------- Citas del cliente ----------

    public function crear(): array
    {
        $claims = Guard::usuario(['cliente', 'admin']);
        $datos = Http::body();
        Validar::sinAtaques($datos);

        $mascota = $this->mascotaPropia(is_string($datos['mascota_id'] ?? null) ? $datos['mascota_id'] : '', $claims);
        if (!(int) $mascota['activa']) {
            throw new ApiError(422, 'Esa mascota ya no está activa', ['campo' => 'mascota_id']);
        }
        $servicio = $this->servicio($datos['servicio'] ?? null);
        $fecha = self::fecha($datos['fecha'] ?? null);
        $hora = is_string($datos['hora'] ?? null) ? $datos['hora'] : '';
        $nombre = Validar::texto($datos, 'nombre', 2, 100);
        $telefono = self::telefono($datos['telefono'] ?? null);
        $notas = isset($datos['notas']) && $datos['notas'] !== '' ? Validar::texto($datos, 'notas', 1, 300) : null;

        $db = Db::escritura();
        $turno = array_values(array_filter($this->turnos($servicio['sede'], $fecha, $db), fn($t) => $t['hora'] === $hora))[0] ?? null;
        if ($turno === null) {
            throw new ApiError(422, 'Ese turno no está disponible', ['campo' => 'hora']);
        }
        $inicio = $fecha->format('Y-m-d') . " $hora:00";

        $q = $db->prepare("SELECT COUNT(*) FROM citas WHERE id_cliente = ? AND estado IN ('pendiente','confirmada') AND inicio > NOW()");
        $q->execute([(int) $claims['sub']]);
        if ((int) $q->fetchColumn() >= self::MAX_ACTIVAS) {
            throw new ApiError(409, 'Ya tienes ' . self::MAX_ACTIVAS . ' citas próximas. Cancela alguna o espera a que pasen');
        }

        // Se prueba cada cupo; el índice único decide quién se queda con el turno.
        $id = Jwt::uuid();
        $insertar = $db->prepare('INSERT INTO citas (id, id_cliente, mascota_id, servicio, sede, inicio, cupo, cliente_nombre, cliente_email, telefono, notas)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $guardada = false;
        for ($cupo = 1; $cupo <= self::cupos() && !$guardada; $cupo++) {
            try {
                $insertar->execute([$id, (int) $claims['sub'], $mascota['id'], $servicio['slug'], $servicio['sede'], $inicio, $cupo,
                    $nombre, $claims['email'], $telefono, $notas]);
                $guardada = true;
            } catch (\PDOException $e) {
                if (($e->errorInfo[1] ?? null) !== 1062) {
                    throw $e;
                }
                if (str_contains($e->getMessage(), 'uq_citas_mascota')) {
                    throw new ApiError(409, "{$mascota['nombre']} ya tiene una cita a esa hora");
                }
            }
        }
        if (!$guardada) {
            throw new ApiError(409, 'Ese turno se acaba de llenar. Elige otro');
        }
        $db->prepare('INSERT INTO historial_citas (cita_id, estado_anterior, estado_nuevo, cambiado_por, comentario) VALUES (?, NULL, ?, ?, ?)')
            ->execute([$id, 'pendiente', (int) $claims['sub'], 'Cita reservada por el cliente']);

        Auditoria::registrar('CITA_CREADA', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['cita_id' => $id, 'servicio' => $servicio['slug'], 'sede' => $servicio['sede'], 'inicio' => $inicio,
                             'mascota_id' => $mascota['id']],
        ]);
        return [201, ['cita' => self::citaJson($this->citaPorId($id))]];
    }

    public function misCitas(): array
    {
        $claims = Guard::usuario(['cliente', 'admin']);
        $q = Db::escritura()->prepare(self::SQL_CITA . ' WHERE c.id_cliente = ? ORDER BY c.inicio DESC LIMIT 100');
        $q->execute([(int) $claims['sub']]);
        return [200, ['citas' => array_map(fn($c) => self::citaJson($c), $q->fetchAll())]];
    }

    public function cancelar(string $id): array
    {
        $claims = Guard::usuario(['cliente', 'admin']);
        $cita = $this->citaPropia($id, $claims);
        if (!in_array($cita['estado'], ['pendiente', 'confirmada'], true)) {
            throw new ApiError(409, 'Esta cita ya no se puede cancelar');
        }
        if (strtotime($cita['inicio']) - time() < self::CANCELAR_HORAS * 3600) {
            throw new ApiError(409, 'Solo se puede cancelar hasta ' . self::CANCELAR_HORAS . ' horas antes. Llámanos para cambiarla');
        }
        $this->moverEstado($cita, 'cancelada', $claims, 'Cancelada por el cliente', 'CITA_CANCELADA');
        return [200, ['cita' => self::citaJson($this->citaPorId($id))]];
    }

    // ---------- Administración ----------

    public function agenda(): array
    {
        Guard::usuario(['admin']);
        $fecha = self::fecha($_GET['fecha'] ?? date('Y-m-d'), true);
        $sede = $_GET['sede'] ?? null;
        $sql = self::SQL_CITA . ' WHERE c.inicio >= ? AND c.inicio < ? + INTERVAL 1 DAY';
        $params = [$fecha->format('Y-m-d'), $fecha->format('Y-m-d')];
        if ($sede !== null && $sede !== '') {
            if (!isset(self::SEDES[$sede])) {
                throw new ApiError(422, 'Sede no válida', ['campo' => 'sede']);
            }
            $sql .= ' AND c.sede = ?';
            $params[] = $sede;
        }
        $q = Db::escritura()->prepare($sql . ' ORDER BY c.inicio, c.sede, c.cupo');
        $q->execute($params);
        return [200, ['fecha' => $fecha->format('Y-m-d'), 'citas' => array_map(fn($c) => self::citaJson($c, true), $q->fetchAll())]];
    }

    public function cambiarEstado(string $id): array
    {
        $claims = Guard::usuario(['admin']);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $nuevo = $datos['estado'] ?? null;
        $cita = $this->citaPorId($id) ?? throw new ApiError(404, 'Cita no encontrada');
        if (!is_string($nuevo) || !in_array($nuevo, self::TRANSICIONES[$cita['estado']], true)) {
            throw new ApiError(422, "No se puede pasar de {$cita['estado']} a " . (is_string($nuevo) ? $nuevo : '?'), ['campo' => 'estado']);
        }
        if (in_array($nuevo, ['atendida', 'no_asistio'], true) && substr($cita['inicio'], 0, 10) > date('Y-m-d')) {
            throw new ApiError(422, 'Solo se marca como atendida o no asistió el día de la cita o después', ['campo' => 'estado']);
        }
        $comentario = isset($datos['comentario']) && $datos['comentario'] !== '' ? Validar::texto($datos, 'comentario', 1, 200) : null;
        $this->moverEstado($cita, $nuevo, $claims, $comentario, 'CITA_ESTADO_CAMBIADO');
        return [200, ['cita' => self::citaJson($this->citaPorId($id), true)]];
    }

    // ---------- Apoyo ----------

    private const SQL_CITA = 'SELECT c.*, m.nombre AS mascota_nombre, m.especie, m.raza, m.notas AS mascota_notas, s.nombre AS servicio_nombre
                                FROM citas c JOIN mascotas m ON m.id = c.mascota_id JOIN servicios s ON s.slug = c.servicio';

    /** Cambio de estado con bloqueo de fila: dos admins no pisan el mismo cambio. */
    private function moverEstado(array $cita, string $nuevo, array $claims, ?string $comentario, string $evento): void
    {
        $db = Db::escritura();
        $db->beginTransaction();
        try {
            $q = $db->prepare('SELECT estado FROM citas WHERE id = ? FOR UPDATE');
            $q->execute([$cita['id']]);
            $anterior = $q->fetchColumn();
            if ($anterior !== $cita['estado']) {
                throw new ApiError(409, 'La cita cambió mientras tanto, recarga');
            }
            $db->prepare('UPDATE citas SET estado = ? WHERE id = ?')->execute([$nuevo, $cita['id']]);
            $db->prepare('INSERT INTO historial_citas (cita_id, estado_anterior, estado_nuevo, cambiado_por, comentario) VALUES (?, ?, ?, ?, ?)')
                ->execute([$cita['id'], $anterior, $nuevo, (int) $claims['sub'], $comentario]);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        Auditoria::registrar($evento, 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => ['cita_id' => $cita['id'], 'estado' => $anterior],
            'dato_nuevo'    => ['cita_id' => $cita['id'], 'estado' => $nuevo, 'inicio' => $cita['inicio'], 'comentario' => $comentario],
        ]);
    }

    /** @return list<array{hora: string, libres: int}> */
    private function turnos(string $sede, \DateTimeImmutable $fecha, \PDO $db): array
    {
        if ((int) $fecha->format('N') === 7) {
            return []; // domingo cerrado
        }
        $dia = $fecha->format('Y-m-d');
        $q = $db->prepare('SELECT DATE_FORMAT(inicio, "%H:%i") AS hora, COUNT(*) AS n FROM citas
                           WHERE sede = ? AND inicio >= ? AND inicio < ? + INTERVAL 1 DAY AND ocupa = 1 GROUP BY inicio');
        $q->execute([$sede, $dia, $dia]);
        $ocupados = array_column($q->fetchAll(), 'n', 'hora');

        $q = $db->prepare('SELECT hora_inicio, hora_fin FROM turnos_bloqueados WHERE sede = ? AND fecha = ?');
        $q->execute([$sede, $dia]);
        $bloqueos = $q->fetchAll();

        $limite = time() + self::ANTICIPACION_MIN * 60;
        $turnos = [];
        for ($min = self::APERTURA * 60; $min < self::CIERRE * 60; $min += self::TURNO_MIN) {
            $hora = sprintf('%02d:%02d', intdiv($min, 60), $min % 60);
            if (strtotime("$dia $hora:00") < $limite) {
                continue;
            }
            foreach ($bloqueos as $b) {
                if ($b['hora_inicio'] === null || ("$hora:00" >= $b['hora_inicio'] && "$hora:00" < $b['hora_fin'])) {
                    continue 2;
                }
            }
            $libres = self::cupos() - (int) ($ocupados[$hora] ?? 0);
            if ($libres > 0) {
                $turnos[] = ['hora' => $hora, 'libres' => $libres];
            }
        }
        return $turnos;
    }

    private static function cupos(): int
    {
        return max(1, min(5, (int) Env::get('CITAS_CUPOS', '2')));
    }

    private function servicio(mixed $slug): array
    {
        if (is_string($slug) && preg_match('/^[a-z]{3,30}$/', $slug)) {
            $q = Db::lectura()->prepare('SELECT slug, nombre, sede FROM servicios WHERE slug = ? AND activo = 1');
            $q->execute([$slug]);
            if ($s = $q->fetch()) {
                return $s;
            }
        }
        throw new ApiError(422, 'Servicio no válido', ['campo' => 'servicio']);
    }

    /** Fecha Y-m-d entre hoy y MAX_DIAS (el admin puede consultar días pasados). */
    private static function fecha(mixed $valor, bool $pasado = false): \DateTimeImmutable
    {
        $f = is_string($valor) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $valor) : false;
        if (!$f || $f->format('Y-m-d') !== $valor) {
            throw new ApiError(422, 'Fecha no válida', ['campo' => 'fecha']);
        }
        $hoy = new \DateTimeImmutable('today');
        if ((!$pasado && $f < $hoy) || $f > $hoy->modify('+' . self::MAX_DIAS . ' days')) {
            throw new ApiError(422, 'Elige una fecha entre hoy y los próximos ' . self::MAX_DIAS . ' días', ['campo' => 'fecha']);
        }
        return $f;
    }

    private static function datosMascota(array $d): array
    {
        $especie = in_array($d['especie'] ?? null, self::ESPECIES, true) ? $d['especie'] : throw new ApiError(422, 'Especie no válida', ['campo' => 'especie']);
        $sexo = $d['sexo'] ?? null;
        if ($sexo !== null && $sexo !== '' && !in_array($sexo, ['macho', 'hembra'], true)) {
            throw new ApiError(422, 'Sexo no válido', ['campo' => 'sexo']);
        }
        $nacimiento = $d['fecha_nacimiento'] ?? null;
        if ($nacimiento !== null && $nacimiento !== '') {
            $f = is_string($nacimiento) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $nacimiento) : false;
            if (!$f || $f->format('Y-m-d') !== $nacimiento || $f > new \DateTimeImmutable('today') || $f < new \DateTimeImmutable('-40 years')) {
                throw new ApiError(422, 'Fecha de nacimiento no válida', ['campo' => 'fecha_nacimiento']);
            }
        }
        $peso = $d['peso_kg'] ?? null;
        if ($peso !== null && $peso !== '' && (!is_numeric($peso) || (float) $peso <= 0 || (float) $peso > 150)) {
            throw new ApiError(422, 'Peso no válido', ['campo' => 'peso_kg']);
        }
        $opcional = fn(string $campo, int $max) => isset($d[$campo]) && $d[$campo] !== '' ? Validar::texto($d, $campo, 1, $max) : null;
        return [
            'nombre'           => Validar::texto($d, 'nombre', 1, 60),
            'especie'          => $especie,
            'raza'             => $opcional('raza', 60),
            'sexo'             => $sexo ?: null,
            'fecha_nacimiento' => $nacimiento ?: null,
            'peso_kg'          => $peso !== null && $peso !== '' ? round((float) $peso, 2) : null,
            'notas'            => $opcional('notas', 300),
        ];
    }

    private function mascotaPorId(string $id): ?array
    {
        $q = Db::escritura()->prepare('SELECT * FROM mascotas WHERE id = ?');
        $q->execute([$id]);
        return $q->fetch() ?: null;
    }

    private function mascotaPropia(string $id, array $claims): array
    {
        $m = preg_match('/^[0-9a-f\-]{36}$/', $id) ? $this->mascotaPorId($id) : null;
        if (!$m || (int) $m['id_cliente'] !== (int) $claims['sub']) {
            if ($m) {
                Auditoria::registrar('ACCESO_DENEGADO', 'FALLO', Auditoria::actor($claims) + [
                    'dato_nuevo' => ['recurso' => 'mascota', 'mascota_id' => $id, 'motivo' => 'la mascota pertenece a otro cliente'],
                ]);
            }
            throw new ApiError(404, 'Mascota no encontrada', ['campo' => 'mascota_id']);
        }
        return $m;
    }

    private function citaPorId(string $id): ?array
    {
        if (!preg_match('/^[0-9a-f\-]{36}$/', $id)) {
            return null;
        }
        $q = Db::escritura()->prepare(self::SQL_CITA . ' WHERE c.id = ?');
        $q->execute([$id]);
        return $q->fetch() ?: null;
    }

    private function citaPropia(string $id, array $claims): array
    {
        $c = $this->citaPorId($id);
        if (!$c || ($claims['rol'] !== 'admin' && (int) $c['id_cliente'] !== (int) $claims['sub'])) {
            if ($c) {
                Auditoria::registrar('ACCESO_DENEGADO', 'FALLO', Auditoria::actor($claims) + [
                    'dato_nuevo' => ['recurso' => 'cita', 'cita_id' => $id, 'motivo' => 'la cita pertenece a otro cliente'],
                ]);
            }
            throw new ApiError(404, 'Cita no encontrada');
        }
        return $c;
    }

    private static function telefono(mixed $valor): string
    {
        $valor = is_string($valor) ? trim($valor) : '';
        if (!preg_match('/^\+?[0-9 ()\-]{7,20}$/', $valor) || strlen(preg_replace('/\D/', '', $valor)) < 7) {
            throw new ApiError(422, 'Teléfono no válido', ['campo' => 'telefono']);
        }
        return $valor;
    }

    private static function mascotaJson(array $m): array
    {
        return [
            'id' => $m['id'], 'nombre' => $m['nombre'], 'especie' => $m['especie'], 'raza' => $m['raza'], 'sexo' => $m['sexo'],
            'fecha_nacimiento' => $m['fecha_nacimiento'], 'peso_kg' => $m['peso_kg'] !== null ? (float) $m['peso_kg'] : null, 'notas' => $m['notas'],
        ];
    }

    private static function citaJson(array $c, bool $admin = false): array
    {
        $json = [
            'id'       => $c['id'],
            'estado'   => $c['estado'],
            'inicio'   => str_replace(' ', 'T', substr($c['inicio'], 0, 16)),
            'servicio' => ['slug' => $c['servicio'], 'nombre' => $c['servicio_nombre']],
            'sede'     => ['codigo' => $c['sede'], 'nombre' => self::SEDES[$c['sede']]],
            'mascota'  => ['id' => $c['mascota_id'], 'nombre' => $c['mascota_nombre'], 'especie' => $c['especie']],
            'notas'    => $c['notas'],
            'puede_cancelar' => in_array($c['estado'], ['pendiente', 'confirmada'], true)
                && strtotime($c['inicio']) - time() >= self::CANCELAR_HORAS * 3600,
        ];
        if ($admin) {
            $json['cupo'] = (int) $c['cupo'];
            $json['cliente'] = ['id' => (int) $c['id_cliente'], 'nombre' => $c['cliente_nombre'], 'email' => $c['cliente_email'], 'telefono' => $c['telefono']];
            $json['mascota'] += ['raza' => $c['raza'], 'notas' => $c['mascota_notas']];
        }
        return $json;
    }
}
