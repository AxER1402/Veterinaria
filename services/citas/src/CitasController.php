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
 * Mascotas y citas. A01: el dueño sale siempre del JWT; un recurso ajeno responde 404 (como si no
 * existiera) y queda como ACCESO_DENEGADO en la bitácora. La doble reserva la impide la BD
 * (índice único por sede, hora y cupo), no una consulta previa que otra petición podría ganar.
 */
final class CitasController
{
    public const SEDES = [
        'centro' => 'Clínica veterinaria y peluquería · 6a. avenida 9-35, zona 10',
        'norte'  => 'Guardería y hospedaje – Norte · Calzada José Milla y Vidaurre 10-55, zona 6',
        'sur'    => 'Paseadores y cuidadores – Sur · Calzada Aguilar Batres 34-70, zona 11',
    ];
    public const TELEFONO_CLINICA = '+502 2385-6420';
    private const APERTURA = 8;          // lunes a sábado, 8:00–20:00
    private const CIERRE = 20;
    private const TURNO_MIN = 30;
    private const ANTICIPACION_MIN = 60; // no se reserva un turno que empieza en menos de 1 h
    private const MAX_DIAS = 60;
    private const MAX_NOCHES = 30;
    private const CANCELAR_HORAS = 2;
    // D de STRIDE: nadie acapara la agenda. El límite es por mascota (una familia con tres perros
    // puede tener más citas que una con uno) con un tope por cliente.
    private const MAX_ACTIVAS_MASCOTA = 3;
    private const MAX_ACTIVAS_CLIENTE = 10;
    private const MAX_FALTAS = 3;        // faltas en FALTAS_DIAS: ya no reserva en línea, debe llamar
    private const FALTAS_DIAS = 90;
    private const SEPARACION_MIN = 90;   // misma mascota en dos sedes: al menos 1 h 30 entre citas
    private const ESPECIES = ['perro', 'gato', 'conejo', 'ave', 'roedor', 'reptil', 'otro'];
    private const SERVICIO_CLINICO = 'veterinaria'; // solo la consulta lleva historial clínico
    private const MAX_VACUNAS = 20;      // tope de cordura por consulta, no una regla clínica
    private const MAX_MEDICAMENTOS = 15;
    private const MUCOSAS = ['rosadas', 'palidas', 'ictericas', 'cianoticas', 'congestivas'];
    private const HIDRATACION = ['normal', 'leve', 'moderada', 'severa']; // deshidratación
    private const TIPOS_VACUNA = ['vacuna', 'desparasitacion'];
    private const ACTIVAS = "('pendiente','confirmada')";

    /**
     * Transiciones del personal. Las de vuelta atrás (corregir un error) piden un comentario:
     * «atendida» → «no asistió» solo si no tiene ficha clínica, y una cancelada vuelve a pendiente
     * solo si es futura y su cupo sigue libre (lo decide el índice único).
     */
    private const TRANSICIONES = [
        'pendiente'  => ['confirmada', 'cancelada', 'no_asistio', 'atendida'],
        'confirmada' => ['atendida', 'no_asistio', 'cancelada', 'pendiente'],
        'atendida'   => ['no_asistio'],
        'no_asistio' => ['atendida', 'confirmada'],
        'cancelada'  => ['pendiente'],
    ];
    private const REVERSIONES = ['confirmada>pendiente', 'atendida>no_asistio', 'no_asistio>atendida', 'no_asistio>confirmada', 'cancelada>pendiente'];

    // ---------- Públicos ----------

    public function servicios(): array
    {
        $filas = Db::lectura()->query('SELECT slug, nombre, sede, modalidad, precio_desde FROM servicios WHERE activo = 1 ORDER BY sede, nombre')->fetchAll();
        $equipo = [];
        foreach (Db::lectura()->query('SELECT id, servicio, nombre FROM profesionales WHERE activo = 1 ORDER BY nombre')->fetchAll() as $p) {
            $equipo[$p['servicio']][] = ['id' => (int) $p['id'], 'nombre' => $p['nombre']];
        }
        return [200, ['servicios' => array_map(fn($s) => [
            'slug' => $s['slug'], 'nombre' => $s['nombre'], 'precio_desde' => (float) $s['precio_desde'], 'modalidad' => $s['modalidad'],
            'sede' => ['codigo' => $s['sede'], 'nombre' => self::SEDES[$s['sede']]],
            'profesionales' => $s['modalidad'] === 'turno' ? ($equipo[$s['slug']] ?? []) : [],
        ], $filas), 'telefono' => self::TELEFONO_CLINICA]];
    }

    /**
     * Turnos de un día con los cupos libres. Se lee del maestro: la réplica puede ir atrasada y
     * mostrar como libre un turno que ya se ocupó. En hospedaje, con «salida» da los lugares de la estadía.
     */
    public function disponibilidad(): array
    {
        $servicio = $this->servicio($_GET['servicio'] ?? null);
        $fecha = self::fecha($_GET['fecha'] ?? null);
        $profesional = self::profesionalElegido($servicio, $_GET['profesional'] ?? null);
        $db = Db::escritura();
        $dia = $fecha->format('Y-m-d');
        $json = [
            'servicio'  => $servicio['slug'],
            'modalidad' => $servicio['modalidad'],
            'sede'      => ['codigo' => $servicio['sede'], 'nombre' => self::SEDES[$servicio['sede']]],
            'fecha'     => $dia,
            'turnos'    => $this->turnosDia($servicio, $dia, $this->ocupacion($db, $servicio, $dia, $dia), false, false, $profesional),
        ];
        if ($servicio['modalidad'] === 'estadia' && isset($_GET['salida'])) {
            $salida = self::salida($_GET['salida'], $fecha);
            $json['salida'] = $salida;
            $json['libres_estadia'] = $this->libresEstadia($db, $servicio, $dia, $salida);
        }
        return [200, $json];
    }

    /** Días de los próximos 60 con lugar, llenos o cerrados: la reserva abre en el primero con lugar. */
    public function calendario(): array
    {
        $servicio = $this->servicio($_GET['servicio'] ?? null);
        $profesional = self::profesionalElegido($servicio, $_GET['profesional'] ?? null);
        $hoy = new \DateTimeImmutable('today');
        $hasta = $hoy->modify('+' . self::MAX_DIAS . ' days');
        $ocupacion = $this->ocupacion(Db::escritura(), $servicio, $hoy->format('Y-m-d'), $hasta->format('Y-m-d'));
        $dias = [];
        for ($d = $hoy; $d <= $hasta; $d = $d->modify('+1 day')) {
            $dia = $d->format('Y-m-d');
            $turnos = $this->turnosDia($servicio, $dia, $ocupacion, false, false, $profesional);
            $libres = array_sum(array_column($turnos, 'libres'));
            $dias[] = ['fecha' => $dia, 'libres' => $libres,
                       'estado' => (int) $d->format('N') === 7 ? 'cerrado' : ($libres > 0 ? 'libre' : 'lleno')];
        }
        $primero = array_values(array_filter($dias, fn($x) => $x['estado'] === 'libre'))[0]['fecha'] ?? null;
        return [200, ['servicio' => $servicio['slug'], 'primer_dia_libre' => $primero, 'dias' => $dias]];
    }

    // ---------- Mascotas del cliente ----------

    /** Con su próxima cita y su próxima vacuna, para mostrarlas en cada tarjeta. */
    public function mascotas(): array
    {
        $claims = Guard::usuario(['cliente', ...Guard::CLINICA]);
        $db = Db::escritura();
        $q = $db->prepare("SELECT m.*,
                                  (SELECT CONCAT(c.inicio, '|', s.nombre) FROM citas c JOIN servicios s ON s.slug = c.servicio
                                    WHERE c.mascota_id = m.id AND c.estado IN " . self::ACTIVAS . " AND c.inicio >= NOW() ORDER BY c.inicio LIMIT 1) AS proxima_cita,
                                  (SELECT CONCAT(v.proxima_dosis, '|', v.nombre) FROM vacunas v
                                    WHERE v.mascota_id = m.id AND v.proxima_dosis >= CURDATE() - INTERVAL 30 DAY
                                      AND NOT EXISTS (SELECT 1 FROM vacunas n WHERE n.mascota_id = v.mascota_id AND n.tipo = v.tipo AND n.nombre = v.nombre
                                                      AND n.fecha_aplicacion > v.fecha_aplicacion)
                                    ORDER BY v.proxima_dosis LIMIT 1) AS proxima_vacuna
                             FROM mascotas m WHERE m.id_cliente = ? AND m.activa = 1 ORDER BY m.created_at");
        $q->execute([(int) $claims['sub']]);
        return [200, ['mascotas' => array_map(function ($m) {
            $cita = $m['proxima_cita'] ? explode('|', $m['proxima_cita'], 2) : null;
            $vacuna = $m['proxima_vacuna'] ? explode('|', $m['proxima_vacuna'], 2) : null;
            return self::mascotaJson($m) + [
                'proxima_cita'   => $cita ? ['inicio' => str_replace(' ', 'T', substr($cita[0], 0, 16)), 'servicio' => $cita[1]] : null,
                'proxima_vacuna' => $vacuna ? ['fecha' => $vacuna[0], 'nombre' => $vacuna[1]] : null,
            ];
        }, $q->fetchAll())]];
    }

    public function crearMascota(): array
    {
        $claims = Guard::usuario(['cliente', ...Guard::CLINICA]);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        return [201, ['mascota' => $this->insertarMascota((int) $claims['sub'], self::datosMascota($datos), $claims)]];
    }

    /** El personal registra la mascota de un cliente que llama o llega sin cita. */
    public function crearMascotaCliente(int $clienteId): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        if ($clienteId < 1) {
            throw new ApiError(422, 'Cliente no válido');
        }
        return [201, ['mascota' => $this->insertarMascota($clienteId, self::datosMascota($datos), $claims)]];
    }

    private function insertarMascota(int $clienteId, array $m, array $claims): array
    {
        $id = Jwt::uuid();
        $columnas = array_keys($m);
        Db::escritura()->prepare('INSERT INTO mascotas (id, id_cliente, ' . implode(', ', $columnas) . ') VALUES (?, ?' . str_repeat(', ?', count($m)) . ')')
            ->execute([$id, $clienteId, ...array_values($m)]);
        Auditoria::registrar('MASCOTA_REGISTRADA', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['mascota_id' => $id, 'nombre' => $m['nombre'], 'especie' => $m['especie'], 'dueno_id' => $clienteId],
        ]);
        return self::mascotaJson($this->mascotaPorId($id));
    }

    public function actualizarMascota(string $id): array
    {
        $claims = Guard::usuario(['cliente', ...Guard::CLINICA]);
        $actual = $this->mascotaPropia($id, $claims);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $m = self::datosMascota($datos + self::mascotaJson($actual));
        // Las columnas salen de datosMascota() (lista fija); los valores van como parámetros.
        Db::escritura()->prepare('UPDATE mascotas SET ' . implode(', ', array_map(fn($c) => "$c = ?", array_keys($m))) . ' WHERE id = ?')
            ->execute([...array_values($m), $id]);

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
        $claims = Guard::usuario(['cliente', ...Guard::CLINICA]);
        $this->mascotaPropia($id, $claims);
        $db = Db::escritura();
        $q = $db->prepare('SELECT COUNT(*) FROM citas WHERE mascota_id = ? AND estado IN ' . self::ACTIVAS . ' AND inicio > NOW()');
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

    // ---------- Citas ----------

    /** Reserva del cliente desde la página. */
    public function crear(): array
    {
        $claims = Guard::usuario(['cliente', ...Guard::CLINICA]);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $mascota = $this->mascotaPropia(is_string($datos['mascota_id'] ?? null) ? $datos['mascota_id'] : '', $claims);
        $contacto = ['nombre' => Validar::texto($datos, 'nombre', 2, 100), 'email' => $claims['email'], 'telefono' => self::telefono($datos['telefono'] ?? null)];
        return [201, $this->reservar($claims, $mascota, $datos, $contacto, false)];
    }

    /** Cita que agenda el personal para alguien que llama o llega sin cita (sin los límites del cliente). */
    public function crearAdmin(): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $mascota = $this->mascotaAdmin(is_string($datos['mascota_id'] ?? null) ? $datos['mascota_id'] : '');
        $contacto = ['nombre' => Validar::texto($datos, 'nombre', 2, 100), 'email' => Validar::email($datos), 'telefono' => self::telefono($datos['telefono'] ?? null)];
        return [201, $this->reservar($claims, $mascota, $datos, $contacto, true)];
    }

    /**
     * Valida y guarda una reserva. La doble reserva la impide la BD (índice único por servicio, hora y
     * cupo); en hospedaje, que cruza varias noches, se serializa con un bloqueo de la fila del servicio.
     */
    private function reservar(array $claims, array $mascota, array $datos, array $contacto, bool $personal): array
    {
        if (!(int) $mascota['activa']) {
            throw new ApiError(422, 'Esa mascota ya no está activa', ['campo' => 'mascota_id']);
        }
        $servicio = $this->servicio($datos['servicio'] ?? null);
        $profesional = self::profesionalElegido($servicio, $datos['profesional_id'] ?? null);
        [$inicio, $fin] = $this->horario($servicio, $datos, $personal, $profesional);
        $notas = isset($datos['notas']) && $datos['notas'] !== '' ? Validar::texto($datos, 'notas', 1, 300) : null;
        if ($servicio['slug'] === self::SERVICIO_CLINICO && $notas === null) {
            throw new ApiError(422, 'Cuéntanos el motivo de la consulta', ['campo' => 'notas']);
        }
        $clienteId = (int) $mascota['id_cliente'];
        $db = Db::escritura();
        if (!$personal) {
            $this->limitesCliente($db, $clienteId, $mascota);
        }
        $aviso = $this->choques($db, $mascota, $servicio, $inicio, null);

        $id = Jwt::uuid();
        $insertar = $db->prepare('INSERT INTO citas (id, id_cliente, mascota_id, servicio, sede, inicio, fin, cupo, cliente_nombre, cliente_email, telefono, notas)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $db->beginTransaction();
        try {
            $this->asignarCupo($db, $servicio, $inicio, $fin, null, fn(int $cupo) => $insertar->execute([
                $id, $clienteId, $mascota['id'], $servicio['slug'], $servicio['sede'], $inicio, $fin, $cupo,
                $contacto['nombre'], $contacto['email'], $contacto['telefono'], $notas]), $mascota['nombre'], $profesional);
            // Si el personal bloqueó el turno mientras tanto, bloquear() tenía el rango y este INSERT esperó a
            // que terminara: la lectura con bloqueo ya ve el bloqueo confirmado y la reserva se deshace.
            if ($this->bloqueado($db, $servicio['sede'], substr($inicio, 0, 10), substr($inicio, 11, 5))) {
                throw new ApiError(422, 'Ese turno no está disponible', ['campo' => 'hora']);
            }
            $db->prepare('INSERT INTO historial_citas (cita_id, estado_anterior, estado_nuevo, cambiado_por, comentario) VALUES (?, NULL, ?, ?, ?)')
                ->execute([$id, 'pendiente', (int) $claims['sub'], $personal ? 'Cita agendada por el personal' : 'Cita reservada por el cliente']);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }

        Auditoria::registrar('CITA_CREADA', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['cita_id' => $id, 'servicio' => $servicio['slug'], 'sede' => $servicio['sede'], 'inicio' => $inicio, 'fin' => $fin,
                             'mascota_id' => $mascota['id'], 'origen' => $personal ? 'personal' : 'cliente', 'profesional_id' => $profesional],
        ]);
        $this->notificar('reservada', $this->citaPorId($id));
        return ['cita' => self::citaJson($this->citaPorId($id), $personal), 'aviso' => $aviso];
    }

    /** @return array{0: string, 1: ?string} inicio y fin («Y-m-d H:i:s») según la modalidad del servicio */
    private function horario(array $servicio, array $datos, bool $personal, ?int $profesional = null): array
    {
        $fecha = self::fecha($datos['fecha'] ?? null);
        $dia = $fecha->format('Y-m-d');
        $hora = $servicio['modalidad'] === 'turno' ? (is_string($datos['hora'] ?? null) ? $datos['hora'] : '') : '08:00';
        $db = Db::escritura();
        $turno = array_values(array_filter($this->turnosDia($servicio, $dia, $this->ocupacion($db, $servicio, $dia, $dia), true, $personal, $profesional),
            fn($t) => $t['hora'] === $hora))[0] ?? null;
        if ($turno === null) {
            throw new ApiError(422, $servicio['modalidad'] === 'turno' ? 'Ese turno no está disponible' : 'Ese día no está disponible', ['campo' => 'hora']);
        }
        if ($turno['libres'] === 0) {
            throw new ApiError(409, $profesional !== null ? 'Ese profesional ya tiene ese turno ocupado. Elige otro' : 'Ese turno se acaba de llenar. Elige otro');
        }
        $fin = null;
        if ($servicio['modalidad'] === 'estadia') {
            $salida = self::salida($datos['salida'] ?? null, $fecha);
            if ($this->libresEstadia($db, $servicio, $dia, $salida) === 0) {
                throw new ApiError(409, 'No quedan lugares para esas noches. Elige otras fechas');
            }
            $fin = "$salida 08:00:00";
        }
        return ["$dia $hora:00", $fin];
    }

    /** Límites de la reserva en línea: por mascota, por cliente y por faltas recientes. */
    private function limitesCliente(\PDO $db, int $clienteId, array $mascota): void
    {
        $q = $db->prepare('SELECT COUNT(*) FROM citas WHERE id_cliente = ? AND estado = ? AND inicio >= NOW() - INTERVAL ? DAY AND inicio < NOW()');
        $q->execute([$clienteId, 'no_asistio', self::FALTAS_DIAS]);
        if ((int) $q->fetchColumn() >= self::MAX_FALTAS) {
            throw new ApiError(409, 'Tienes ' . self::MAX_FALTAS . ' o más citas a las que no asististe en los últimos 3 meses. Para reservar, llámanos al '
                . self::TELEFONO_CLINICA, ['motivo' => 'faltas']);
        }
        $q = $db->prepare('SELECT COUNT(*) FROM citas WHERE mascota_id = ? AND estado IN ' . self::ACTIVAS . ' AND inicio > NOW()');
        $q->execute([$mascota['id']]);
        if ((int) $q->fetchColumn() >= self::MAX_ACTIVAS_MASCOTA) {
            throw new ApiError(409, "{$mascota['nombre']} ya tiene " . self::MAX_ACTIVAS_MASCOTA . ' citas próximas. Cancela alguna o espera a que pasen');
        }
        $q = $db->prepare('SELECT COUNT(*) FROM citas WHERE id_cliente = ? AND estado IN ' . self::ACTIVAS . ' AND inicio > NOW()');
        $q->execute([$clienteId]);
        if ((int) $q->fetchColumn() >= self::MAX_ACTIVAS_CLIENTE) {
            throw new ApiError(409, 'Ya tienes ' . self::MAX_ACTIVAS_CLIENTE . ' citas próximas. Cancela alguna o espera a que pasen');
        }
    }

    /**
     * Otra cita de la misma mascota ese día: en otra sede y muy pegada se rechaza (no llega a tiempo);
     * si no, se devuelve un aviso para mostrarlo.
     */
    private function choques(\PDO $db, array $mascota, array $servicio, string $inicio, ?string $excluir): ?string
    {
        $q = $db->prepare('SELECT c.inicio, c.sede, s.nombre FROM citas c JOIN servicios s ON s.slug = c.servicio
                            WHERE c.mascota_id = ? AND c.estado IN ' . self::ACTIVAS . ' AND c.inicio >= ? AND c.inicio < ? + INTERVAL 1 DAY AND c.id <> ?');
        $dia = substr($inicio, 0, 10);
        $q->execute([$mascota['id'], $dia, $dia, $excluir ?? '']);
        $otras = $q->fetchAll();
        foreach ($otras as $o) {
            if ($o['sede'] !== $servicio['sede'] && abs(strtotime($o['inicio']) - strtotime($inicio)) < self::SEPARACION_MIN * 60) {
                throw new ApiError(409, "{$mascota['nombre']} tiene {$o['nombre']} a las " . substr($o['inicio'], 11, 5)
                    . ' en otra sede. Deja al menos 1 h 30 entre las dos citas', ['campo' => 'hora']);
            }
        }
        return $otras ? "{$mascota['nombre']} ya tiene otra cita ese día: " . implode(', ', array_map(fn($o) => "{$o['nombre']} a las " . substr($o['inicio'], 11, 5), $otras)) . '.' : null;
    }

    /**
     * Prueba los cupos del servicio con $guardar(cupo) hasta que el índice único acepte uno. En hospedaje
     * se toma la fila del servicio con FOR UPDATE y se elige un cupo libre en todas las noches.
     */
    private function asignarCupo(\PDO $db, array $servicio, string $inicio, ?string $fin, ?string $excluir, callable $guardar, string $mascota,
                                 ?int $profesional = null, ?int $preferido = null): void
    {
        if ($servicio['profesionales']) {
            // Quienes atienden ese turno (el elegido, o todos con el preferido primero); el índice único decide.
            $dia = substr($inicio, 0, 10);
            $hora = substr($inicio, 11, 5);
            $candidatos = $profesional !== null ? [$profesional] : self::profesionalesDelTurno($servicio, $dia, $hora, []);
            if ($preferido !== null && in_array($preferido, $candidatos, true)) {
                $candidatos = [$preferido, ...array_values(array_diff($candidatos, [$preferido]))];
            }
            foreach ($candidatos as $id) {
                if ($this->guardarCupo($guardar, $id, $mascota)) {
                    return;
                }
            }
            throw new ApiError(409, $profesional !== null ? 'Ese profesional ya tiene ese turno ocupado. Elige otro' : 'Ese turno se acaba de llenar. Elige otro');
        }
        if ($servicio['modalidad'] === 'estadia') {
            $db->prepare('SELECT slug FROM servicios WHERE slug = ? FOR UPDATE')->execute([$servicio['slug']]);
            $q = $db->prepare('SELECT cupo FROM citas WHERE servicio = ? AND ocupa = 1 AND inicio < ? AND fin > ? AND id <> ?');
            $q->execute([$servicio['slug'], $fin, $inicio, $excluir ?? '']);
            $usados = array_map('intval', $q->fetchAll(\PDO::FETCH_COLUMN));
            for ($cupo = 1; $cupo <= (int) $servicio['cupos']; $cupo++) {
                if (!in_array($cupo, $usados, true)) {
                    $this->guardarCupo($guardar, $cupo, $mascota);
                    return;
                }
            }
            throw new ApiError(409, 'No quedan lugares para esas noches. Elige otras fechas');
        }
        for ($cupo = 1; $cupo <= (int) $servicio['cupos']; $cupo++) {
            if ($this->guardarCupo($guardar, $cupo, $mascota)) {
                return;
            }
        }
        throw new ApiError(409, 'Ese turno se acaba de llenar. Elige otro');
    }

    /** true si el cupo quedó; false si otra cita ya lo tiene (1062 en el índice del turno). */
    private function guardarCupo(callable $guardar, int $cupo, string $mascota): bool
    {
        try {
            $guardar($cupo);
            return true;
        } catch (\PDOException $e) {
            if (($e->errorInfo[1] ?? null) !== 1062) {
                throw $e;
            }
            if (str_contains($e->getMessage(), 'uq_citas_mascota')) {
                throw new ApiError(409, "$mascota ya tiene una cita a esa hora");
            }
            return false;
        }
    }

    public function misCitas(): array
    {
        $claims = Guard::usuario(['cliente', ...Guard::CLINICA]);
        $q = Db::escritura()->prepare(self::SQL_CITA . ' WHERE c.id_cliente = ? ORDER BY c.inicio DESC LIMIT 200');
        $q->execute([(int) $claims['sub']]);
        return [200, ['citas' => array_map(fn($c) => self::citaJson($c), $q->fetchAll()), 'telefono' => self::TELEFONO_CLINICA]];
    }

    public function cancelar(string $id): array
    {
        $claims = Guard::usuario(['cliente', ...Guard::CLINICA]);
        $cita = $this->citaPropia($id, $claims);
        if (!in_array($cita['estado'], ['pendiente', 'confirmada'], true)) {
            throw new ApiError(409, 'Esta cita ya no se puede cancelar');
        }
        if (strtotime($cita['inicio']) - time() < self::CANCELAR_HORAS * 3600) {
            throw new ApiError(409, 'Solo se puede cancelar hasta ' . self::CANCELAR_HORAS . ' horas antes. Llámanos al ' . self::TELEFONO_CLINICA);
        }
        $this->moverEstado($cita, 'cancelada', $claims, 'Cancelada por el cliente', 'CITA_CANCELADA');
        return [200, ['cita' => self::citaJson($this->citaPorId($id))]];
    }

    /**
     * Cambia el día y la hora (y en hospedaje la salida). El cliente, hasta 2 horas antes y la cita vuelve
     * a quedar pendiente de confirmar; el personal, en cualquier momento y conserva el estado.
     */
    public function reprogramar(string $id): array
    {
        $claims = Guard::usuario(['cliente', ...Guard::CLINICA]);
        $personal = in_array($claims['rol'], Guard::CLINICA, true);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $cita = $this->citaPropia($id, $claims);
        if (!in_array($cita['estado'], ['pendiente', 'confirmada'], true)) {
            throw new ApiError(409, 'Esta cita ya no se puede reprogramar');
        }
        if (!$personal && strtotime($cita['inicio']) - time() < self::CANCELAR_HORAS * 3600) {
            throw new ApiError(409, 'Solo se puede reprogramar hasta ' . self::CANCELAR_HORAS . ' horas antes. Llámanos al ' . self::TELEFONO_CLINICA);
        }
        $servicio = $this->servicio($cita['servicio']);
        $mascota = $this->mascotaPorId($cita['mascota_id']);
        $profesional = self::profesionalElegido($servicio, $datos['profesional_id'] ?? null);
        [$inicio, $fin] = $this->horario($servicio, $datos + ['servicio' => $servicio['slug']], $personal, $profesional);
        if ($inicio === $cita['inicio'] && $fin === $cita['fin'] && ($profesional === null || $profesional === (int) $cita['cupo'])) {
            throw new ApiError(422, 'Elige un día u hora distintos', ['campo' => 'hora']);
        }
        $aviso = $this->choques(Db::escritura(), $mascota, $servicio, $inicio, $id);
        $estado = $personal ? $cita['estado'] : 'pendiente';
        $comentario = 'Reprogramada de ' . substr($cita['inicio'], 0, 16) . ' a ' . substr($inicio, 0, 16) . ($personal ? ' por el personal' : ' por el cliente');

        $db = Db::escritura();
        $actualizar = $db->prepare('UPDATE citas SET inicio = ?, fin = ?, cupo = ?, estado = ?, recordatorio_at = NULL WHERE id = ?');
        $db->beginTransaction();
        try {
            $q = $db->prepare('SELECT estado FROM citas WHERE id = ? FOR UPDATE');
            $q->execute([$id]);
            if ($q->fetchColumn() !== $cita['estado']) {
                throw new ApiError(409, 'La cita cambió mientras tanto, recarga');
            }
            $this->asignarCupo($db, $servicio, $inicio, $fin, $id, fn(int $cupo) => $actualizar->execute([$inicio, $fin, $cupo, $estado, $id]), $mascota['nombre'],
                $profesional, $servicio['profesionales'] ? (int) $cita['cupo'] : null);
            if ($this->bloqueado($db, $servicio['sede'], substr($inicio, 0, 10), substr($inicio, 11, 5))) {
                throw new ApiError(422, 'Ese turno no está disponible', ['campo' => 'hora']);
            }
            $db->prepare('INSERT INTO historial_citas (cita_id, estado_anterior, estado_nuevo, cambiado_por, comentario) VALUES (?, ?, ?, ?, ?)')
                ->execute([$id, $cita['estado'], $estado, (int) $claims['sub'], $comentario]);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        Auditoria::registrar('CITA_REPROGRAMADA', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => ['cita_id' => $id, 'inicio' => $cita['inicio'], 'fin' => $cita['fin'], 'estado' => $cita['estado']],
            'dato_nuevo'    => ['cita_id' => $id, 'inicio' => $inicio, 'fin' => $fin, 'estado' => $estado],
        ]);
        $this->notificar('reprogramada', $this->citaPorId($id));
        return [200, ['cita' => self::citaJson($this->citaPorId($id), $personal), 'aviso' => $aviso]];
    }

    // ---------- Agenda del personal ----------

    public function agenda(): array
    {
        Guard::usuario(Guard::CLINICA);
        $fecha = self::fecha($_GET['fecha'] ?? date('Y-m-d'), true);
        $sede = self::sedeFiltro();
        $dia = $fecha->format('Y-m-d');
        // Un hospedaje aparece todos los días de la estadía, no solo el de entrada.
        $sql = self::SQL_CITA . ' WHERE ((c.inicio >= ? AND c.inicio < ? + INTERVAL 1 DAY) OR (c.fin IS NOT NULL AND c.inicio < ? AND c.fin > ?))';
        $params = [$dia, $dia, $dia, $dia];
        if ($sede !== null) {
            $sql .= ' AND c.sede = ?';
            $params[] = $sede;
        }
        $q = Db::escritura()->prepare($sql . ' ORDER BY c.inicio, c.sede, c.cupo');
        $q->execute($params);
        $citas = array_map(fn($c) => self::citaJson($c, true), $q->fetchAll());

        $b = Db::escritura()->prepare('SELECT * FROM turnos_bloqueados WHERE activo = 1 AND fecha = ?' . ($sede ? ' AND sede = ?' : '') . ' ORDER BY sede, hora_inicio');
        $b->execute($sede ? [$dia, $sede] : [$dia]);
        return [200, ['fecha' => $dia, 'citas' => $citas, 'bloqueos' => array_map(fn($x) => self::bloqueoJson($x), $b->fetchAll())]];
    }

    /** Vista semanal: citas por día (lunes a sábado) de la semana de la fecha. */
    public function semana(): array
    {
        Guard::usuario(Guard::CLINICA);
        $fecha = self::fecha($_GET['fecha'] ?? date('Y-m-d'), true);
        $lunes = $fecha->modify('-' . ((int) $fecha->format('N') - 1) . ' days');
        $sede = self::sedeFiltro();
        $q = Db::escritura()->prepare('SELECT DATE(inicio) AS dia, estado, COUNT(*) AS n FROM citas WHERE inicio >= ? AND inicio < ? + INTERVAL 6 DAY'
            . ($sede ? ' AND sede = ?' : '') . ' GROUP BY DATE(inicio), estado');
        $q->execute(array_filter([$lunes->format('Y-m-d'), $lunes->format('Y-m-d'), $sede]));
        $conteo = [];
        foreach ($q->fetchAll() as $f) {
            $conteo[$f['dia']][$f['estado']] = (int) $f['n'];
        }
        $dias = [];
        for ($i = 0; $i < 6; $i++) {
            $dia = $lunes->modify("+$i days")->format('Y-m-d');
            $e = $conteo[$dia] ?? [];
            $dias[] = ['fecha' => $dia, 'activas' => array_sum($e) - ($e['cancelada'] ?? 0), 'pendientes' => $e['pendiente'] ?? 0,
                       'canceladas' => $e['cancelada'] ?? 0];
        }
        return [200, ['dias' => $dias]];
    }

    /** Busca citas por mascota, cliente, correo o teléfono (de 3 meses atrás a 2 meses adelante). */
    public function buscar(): array
    {
        Guard::usuario(Guard::CLINICA);
        $texto = is_string($_GET['q'] ?? null) ? trim($_GET['q']) : '';
        if (mb_strlen($texto) < 2 || mb_strlen($texto) > 60) {
            throw new ApiError(422, 'Escribe al menos 2 letras', ['campo' => 'q']);
        }
        $patron = '%' . addcslashes($texto, '%_\\') . '%';
        $q = Db::escritura()->prepare(self::SQL_CITA . ' WHERE c.inicio >= NOW() - INTERVAL 90 DAY AND c.inicio < NOW() + INTERVAL 61 DAY
                                       AND (m.nombre LIKE ? OR c.cliente_nombre LIKE ? OR c.cliente_email LIKE ? OR c.telefono LIKE ?)
                                     ORDER BY c.inicio DESC LIMIT 50');
        $q->execute([$patron, $patron, $patron, $patron]);
        return [200, ['citas' => array_map(fn($c) => self::citaJson($c, true), $q->fetchAll())]];
    }

    /** Confirma de una vez las pendientes de un día (normalmente mañana) y avisa a cada cliente. */
    public function confirmarDia(): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
        $d = Http::body();
        $fecha = self::fecha($d['fecha'] ?? null);
        $sede = isset($d['sede']) && $d['sede'] !== '' ? (isset(self::SEDES[$d['sede']]) ? $d['sede'] : throw new ApiError(422, 'Sede no válida')) : null;
        $q = Db::escritura()->prepare(self::SQL_CITA . " WHERE c.estado = 'pendiente' AND c.inicio > NOW() AND c.inicio >= ? AND c.inicio < ? + INTERVAL 1 DAY"
            . ($sede ? ' AND c.sede = ?' : ''));
        $q->execute(array_filter([$fecha->format('Y-m-d'), $fecha->format('Y-m-d'), $sede]));
        $confirmadas = 0;
        foreach ($q->fetchAll() as $cita) {
            try {
                $this->moverEstado($cita, 'confirmada', $claims, 'Confirmada junto con las demás del día', 'CITA_ESTADO_CAMBIADO');
            } catch (ApiError) {
                continue; // cambió mientras tanto: se deja como está
            }
            $this->notificar('confirmada', $this->citaPorId($cita['id']));
            $confirmadas++;
        }
        return [200, ['confirmadas' => $confirmadas]];
    }

    /** Próximos bloqueos (feriados, mantenimiento). */
    public function bloqueos(): array
    {
        Guard::usuario(Guard::CLINICA);
        $q = Db::escritura()->query('SELECT * FROM turnos_bloqueados WHERE activo = 1 AND fecha >= CURDATE() ORDER BY fecha, sede, hora_inicio LIMIT 100');
        return [200, ['bloqueos' => array_map(fn($x) => self::bloqueoJson($x), $q->fetchAll())]];
    }

    /**
     * Bloquea un día entero o un rango de turnos de una sede. Si hay citas activas en ese rango, se
     * rechaza (409 con la cantidad) salvo que venga «cancelar_citas»: entonces se cancelan en la misma
     * transacción con el motivo del bloqueo y se avisa a cada cliente.
     */
    public function bloquear(): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
        $d = Http::body();
        Validar::sinAtaques($d);
        $sede = is_string($d['sede'] ?? null) && isset(self::SEDES[$d['sede']]) ? $d['sede'] : throw new ApiError(422, 'Sede no válida', ['campo' => 'sede']);
        $fecha = self::fecha($d['fecha'] ?? null);
        $dia = $fecha->format('Y-m-d');
        $todoElDia = ($d['hora_inicio'] ?? '') === '' && ($d['hora_fin'] ?? '') === '';
        $ini = $fin = null;
        if (!$todoElDia) {
            $ini = self::horaTurno($d['hora_inicio'] ?? null, 'hora_inicio');
            $fin = self::horaTurno($d['hora_fin'] ?? null, 'hora_fin');
            if ($fin <= $ini) {
                throw new ApiError(422, 'La hora final debe ser posterior a la inicial', ['campo' => 'hora_fin']);
            }
        }
        $motivo = Validar::texto($d, 'motivo', 3, 120);
        $cancelar = ($d['cancelar_citas'] ?? false) === true;
        $desde = $todoElDia ? "$dia 00:00:00" : "$dia $ini:00";
        $hasta = $todoElDia ? $fecha->modify('+1 day')->format('Y-m-d 00:00:00') : "$dia $fin:00";

        $db = Db::escritura();
        $canceladas = [];
        $db->beginTransaction();
        try {
            // FOR UPDATE toma el rango del índice: una reserva en ese rango espera a que esto termine.
            $q = $db->prepare('SELECT id, estado, inicio FROM citas WHERE inicio >= ? AND inicio < ? AND sede = ? AND estado IN ' . self::ACTIVAS . ' FOR UPDATE');
            $q->execute([$desde, $hasta, $sede]);
            $activas = $q->fetchAll();
            if ($activas && !$cancelar) {
                $n = count($activas);
                throw new ApiError(409, $n === 1 ? 'Hay 1 cita en ese horario' : "Hay $n citas en ese horario", ['citas' => $n]);
            }
            $comentario = mb_substr("Cancelada por bloqueo: $motivo", 0, 200);
            foreach ($activas as $c) {
                $db->prepare("UPDATE citas SET estado = 'cancelada' WHERE id = ?")->execute([$c['id']]);
                $db->prepare('INSERT INTO historial_citas (cita_id, estado_anterior, estado_nuevo, cambiado_por, comentario) VALUES (?, ?, ?, ?, ?)')
                    ->execute([$c['id'], $c['estado'], 'cancelada', (int) $claims['sub'], $comentario]);
                $canceladas[] = $c;
            }
            $db->prepare('INSERT INTO turnos_bloqueados (sede, fecha, hora_inicio, hora_fin, motivo, creado_por) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$sede, $dia, $ini ? "$ini:00" : null, $fin ? "$fin:00" : null, $motivo, (int) $claims['sub']]);
            $id = (int) $db->lastInsertId();
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        foreach ($canceladas as $c) {
            Auditoria::registrar('CITA_ESTADO_CAMBIADO', 'EXITO', Auditoria::actor($claims) + [
                'dato_anterior' => ['cita_id' => $c['id'], 'estado' => $c['estado']],
                'dato_nuevo'    => ['cita_id' => $c['id'], 'estado' => 'cancelada', 'inicio' => $c['inicio'], 'comentario' => $comentario, 'bloqueo_id' => $id],
            ]);
            $this->notificar('cancelada', $this->citaPorId($c['id']), $motivo);
        }
        $bloqueo = self::bloqueoJson($this->bloqueoPorId($id));
        Auditoria::registrar('TURNO_BLOQUEADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['bloqueo_id' => $id, 'sede' => $sede, 'fecha' => $dia, 'hora_inicio' => $ini, 'hora_fin' => $fin, 'motivo' => $motivo,
                             'citas_canceladas' => count($canceladas)],
        ]);
        return [201, ['bloqueo' => $bloqueo, 'citas_canceladas' => count($canceladas)]];
    }

    public function desbloquear(string $id): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
        $b = ctype_digit($id) ? $this->bloqueoPorId((int) $id) : null;
        if (!$b || !(int) $b['activo']) {
            throw new ApiError(404, 'Bloqueo no encontrado');
        }
        Db::escritura()->prepare('UPDATE turnos_bloqueados SET activo = 0, quitado_por = ?, quitado_at = NOW() WHERE id = ? AND activo = 1')
            ->execute([(int) $claims['sub'], (int) $id]);
        $antes = self::bloqueoJson($b);
        Auditoria::registrar('TURNO_DESBLOQUEADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => ['bloqueo_id' => (int) $id, 'sede' => $b['sede'], 'fecha' => $b['fecha'], 'hora_inicio' => $antes['hora_inicio'],
                                'hora_fin' => $antes['hora_fin'], 'motivo' => $b['motivo'], 'activo' => true],
            'dato_nuevo'    => ['bloqueo_id' => (int) $id, 'activo' => false],
        ]);
        return [200, ['ok' => true]];
    }

    public function cambiarEstado(string $id): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
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
        $reversion = in_array("{$cita['estado']}>$nuevo", self::REVERSIONES, true);
        if ($reversion && $cita['estado'] === 'atendida' && $cita['historial_id'] !== null) {
            throw new ApiError(409, 'Esta consulta ya tiene ficha clínica: corrígela con una adenda');
        }
        if ($reversion && $cita['estado'] === 'cancelada' && strtotime($cita['inicio']) < time()) {
            throw new ApiError(409, 'Solo se reactiva una cita futura');
        }
        $comentario = isset($datos['comentario']) && $datos['comentario'] !== '' ? Validar::texto($datos, 'comentario', $reversion ? 3 : 1, 200) : null;
        if ($reversion && $comentario === null) {
            throw new ApiError(422, 'Explica por qué se corrige el estado', ['campo' => 'comentario']);
        }
        if ($cita['estado'] === 'cancelada' && $cita['modalidad'] === 'estadia') {
            $this->recolocarEstadia($cita);
        }
        $this->moverEstado($cita, $nuevo, $claims, $comentario, 'CITA_ESTADO_CAMBIADO');
        if (in_array($nuevo, ['confirmada', 'cancelada'], true) && $cita['inicio'] > date('Y-m-d H:i:s')) {
            $this->notificar($nuevo, $this->citaPorId($id), $comentario);
        }
        return [200, ['cita' => self::citaJson($this->citaPorId($id), true)]];
    }

    /**
     * Antes de reactivar un hospedaje cancelado: si su lugar ya lo ocupa otra estadía en alguna de sus
     * noches, se le busca otro; si no hay ninguno libre, no se reactiva.
     */
    private function recolocarEstadia(array $cita): void
    {
        $servicio = $this->servicio($cita['servicio']);
        $q = Db::escritura()->prepare('SELECT cupo FROM citas WHERE servicio = ? AND ocupa = 1 AND inicio < ? AND fin > ? AND id <> ?');
        $q->execute([$servicio['slug'], $cita['fin'], $cita['inicio'], $cita['id']]);
        $usados = array_map('intval', $q->fetchAll(\PDO::FETCH_COLUMN));
        if (!in_array((int) $cita['cupo'], $usados, true)) {
            return;
        }
        for ($cupo = 1; $cupo <= (int) $servicio['cupos']; $cupo++) {
            if (!in_array($cupo, $usados, true)) {
                Db::escritura()->prepare("UPDATE citas SET cupo = ? WHERE id = ? AND estado = 'cancelada'")->execute([$cupo, $cita['id']]);
                return;
            }
        }
        throw new ApiError(409, 'Ya no quedan lugares para esas noches: reprograma la estadía en vez de reactivarla');
    }

    // ---------- Equipo (profesionales y horarios) ----------

    /** Equipo de todos los servicios por turnos, con sus citas próximas. */
    public function equipo(): array
    {
        Guard::usuario(Guard::CLINICA);
        $q = Db::escritura()->query("SELECT p.*, s.nombre AS servicio_nombre,
                                            (SELECT COUNT(*) FROM citas c WHERE c.servicio = p.servicio AND c.cupo = p.id
                                               AND c.estado IN " . self::ACTIVAS . " AND c.inicio > NOW()) AS proximas
                                       FROM profesionales p JOIN servicios s ON s.slug = p.servicio ORDER BY p.servicio, p.activo DESC, p.nombre");
        $servicios = Db::escritura()->query("SELECT slug, nombre FROM servicios WHERE activo = 1 AND modalidad = 'turno' ORDER BY nombre")->fetchAll();
        return [200, ['profesionales' => array_map(fn($p) => self::profesionalJson($p) + ['proximas' => (int) $p['proximas']], $q->fetchAll()),
                      'servicios' => $servicios]];
    }

    /**
     * Alta o cambio de un profesional (solo admin). Si al quitarle días u horas (o al desactivarlo) le
     * quedarían citas próximas fuera de su horario, se rechaza con cuántas: primero se reprograman.
     */
    public function guardarProfesional(?int $id = null): array
    {
        $claims = Guard::usuario(['admin']);
        $d = Http::body();
        Validar::sinAtaques($d);
        $db = Db::escritura();
        $actual = null;
        if ($id !== null) {
            $q = $db->prepare('SELECT * FROM profesionales WHERE id = ?');
            $q->execute([$id]);
            $actual = $q->fetch() ?: throw new ApiError(404, 'Profesional no encontrado');
        }
        $servicio = $actual['servicio'] ?? (is_string($d['servicio'] ?? null) ? $d['servicio'] : '');
        $q = $db->prepare("SELECT slug FROM servicios WHERE slug = ? AND modalidad = 'turno'");
        $q->execute([$servicio]);
        if (!$q->fetchColumn()) {
            throw new ApiError(422, 'Elige un servicio por turnos', ['campo' => 'servicio']);
        }
        $dias = $d['dias'] ?? (isset($actual) ? array_map('intval', explode(',', $actual['dias'])) : [1, 2, 3, 4, 5, 6]);
        if (!is_array($dias) || !$dias || array_diff($dias, [1, 2, 3, 4, 5, 6])) {
            throw new ApiError(422, 'Elige al menos un día de lunes a sábado', ['campo' => 'dias']);
        }
        sort($dias);
        $inicio = self::horaTurno($d['hora_inicio'] ?? substr($actual['hora_inicio'] ?? '08:00', 0, 5), 'hora_inicio');
        $fin = self::horaTurno($d['hora_fin'] ?? substr($actual['hora_fin'] ?? '20:00', 0, 5), 'hora_fin');
        if ($fin <= $inicio) {
            throw new ApiError(422, 'La hora de salida debe ser después de la de entrada', ['campo' => 'hora_fin']);
        }
        $activo = $d['activo'] ?? (bool) ($actual['activo'] ?? true);
        if (!is_bool($activo)) {
            throw new ApiError(422, 'Indica si está activo', ['campo' => 'activo']);
        }
        $nuevo = [
            'servicio' => $servicio, 'nombre' => isset($d['nombre']) ? Validar::texto($d, 'nombre', 3, 80) : ($actual['nombre'] ?? Validar::texto($d, 'nombre', 3, 80)),
            'usuario_id' => array_key_exists('usuario_id', $d) ? (is_int($d['usuario_id']) && $d['usuario_id'] > 0 ? $d['usuario_id'] : null) : ($actual['usuario_id'] ?? null),
            'dias' => implode(',', $dias), 'hora_inicio' => "$inicio:00", 'hora_fin' => "$fin:00", 'activo' => (int) $activo,
        ];

        if ($actual) {
            // Citas próximas que quedarían fuera del horario nuevo (o todas, si se desactiva).
            $q = $db->prepare('SELECT inicio FROM citas WHERE servicio = ? AND cupo = ? AND estado IN ' . self::ACTIVAS . ' AND inicio > NOW()');
            $q->execute([$servicio, $id]);
            $fuera = array_filter($q->fetchAll(\PDO::FETCH_COLUMN), fn($i) => !$activo || !in_array((int) date('N', strtotime($i)), $dias, true)
                || substr($i, 11, 8) < "$inicio:00" || substr($i, 11, 8) >= "$fin:00");
            if ($fuera) {
                $n = count($fuera);
                throw new ApiError(409, "Tiene $n " . ($n === 1 ? 'cita próxima' : 'citas próximas') . ' fuera de ese horario. Reprográmalas primero en la agenda', ['citas' => $n]);
            }
            $db->prepare('UPDATE profesionales SET nombre = ?, usuario_id = ?, dias = ?, hora_inicio = ?, hora_fin = ?, activo = ? WHERE id = ?')
                ->execute([$nuevo['nombre'], $nuevo['usuario_id'], $nuevo['dias'], $nuevo['hora_inicio'], $nuevo['hora_fin'], $nuevo['activo'], $id]);
        } else {
            $db->prepare('INSERT INTO profesionales (servicio, nombre, usuario_id, dias, hora_inicio, hora_fin, activo) VALUES (?, ?, ?, ?, ?, ?, ?)')
                ->execute([$servicio, $nuevo['nombre'], $nuevo['usuario_id'], $nuevo['dias'], $nuevo['hora_inicio'], $nuevo['hora_fin'], $nuevo['activo']]);
            $id = (int) $db->lastInsertId();
        }
        Auditoria::registrar('PROFESIONAL_ACTUALIZADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => $actual ? array_intersect_key($actual, $nuevo) + ['profesional_id' => $id] : null,
            'dato_nuevo'    => $nuevo + ['profesional_id' => $id],
        ]);
        return [$actual ? 200 : 201, $this->equipo()[1]];
    }

    private static function profesionalJson(array $p): array
    {
        return [
            'id' => (int) $p['id'], 'servicio' => ['slug' => $p['servicio'], 'nombre' => $p['servicio_nombre'] ?? $p['servicio']], 'nombre' => $p['nombre'],
            'usuario_id' => $p['usuario_id'] !== null ? (int) $p['usuario_id'] : null, 'dias' => array_map('intval', explode(',', $p['dias'])),
            'hora_inicio' => substr($p['hora_inicio'], 0, 5), 'hora_fin' => substr($p['hora_fin'], 0, 5), 'activo' => (bool) $p['activo'],
        ];
    }

    // ---------- Clientes y resumen clínico ----------

    /** Cancelaciones, faltas y citas atendidas por cliente (para la lista de clientes). */
    public function contadoresClientes(): array
    {
        Guard::usuario(Guard::CLINICA);
        $q = Db::escritura()->query("SELECT id_cliente, SUM(estado = 'cancelada') AS canceladas, SUM(estado = 'no_asistio') AS faltas,
                                            SUM(estado = 'atendida') AS atendidas, COUNT(DISTINCT mascota_id) AS mascotas
                                       FROM citas GROUP BY id_cliente");
        $r = [];
        foreach ($q->fetchAll() as $f) {
            $r[(int) $f['id_cliente']] = ['canceladas' => (int) $f['canceladas'], 'faltas' => (int) $f['faltas'], 'atendidas' => (int) $f['atendidas']];
        }
        return [200, ['contadores' => (object) $r]];
    }

    /** Mascotas, citas y contadores de un cliente (ficha del cliente en el panel). */
    public function cliente(int $clienteId): array
    {
        Guard::usuario(Guard::CLINICA);
        $db = Db::escritura();
        $q = $db->prepare('SELECT * FROM mascotas WHERE id_cliente = ? ORDER BY activa DESC, created_at');
        $q->execute([$clienteId]);
        $mascotas = array_map(fn($m) => self::mascotaJson($m) + ['activa' => (bool) $m['activa']], $q->fetchAll());
        $q = $db->prepare(self::SQL_CITA . ' WHERE c.id_cliente = ? ORDER BY c.inicio DESC LIMIT 100');
        $q->execute([$clienteId]);
        $citas = array_map(fn($c) => self::citaJson($c, true), $q->fetchAll());
        $contar = fn(string $e) => count(array_filter($citas, fn($c) => $c['estado'] === $e));
        return [200, [
            'mascotas' => $mascotas, 'citas' => $citas,
            'contadores' => ['canceladas' => $contar('cancelada'), 'faltas' => $contar('no_asistio'), 'atendidas' => $contar('atendida')],
            'telefono' => $citas[0]['cliente']['telefono'] ?? null,
        ]];
    }

    /** Resumen clínico del panel: hoy, pendientes de confirmar, vacunas que vencen esta semana y faltas recientes. */
    public function resumen(): array
    {
        Guard::usuario(Guard::CLINICA);
        $db = Db::escritura();
        $hoy = $db->query("SELECT estado, COUNT(*) AS n FROM citas WHERE inicio >= CURDATE() AND inicio < CURDATE() + INTERVAL 1 DAY GROUP BY estado")->fetchAll();
        $porEstado = array_column($hoy, 'n', 'estado');
        $pendientes = $db->query("SELECT DATE(inicio) AS dia, COUNT(*) AS n FROM citas WHERE estado = 'pendiente' AND inicio > NOW()
                                    AND inicio < CURDATE() + INTERVAL 8 DAY GROUP BY DATE(inicio) ORDER BY dia")->fetchAll();
        $vacunas = $db->query("SELECT v.nombre, v.tipo, v.proxima_dosis, m.id AS mascota_id, m.nombre AS mascota FROM vacunas v
                                 JOIN mascotas m ON m.id = v.mascota_id AND m.activa = 1
                                WHERE v.proxima_dosis BETWEEN CURDATE() AND CURDATE() + INTERVAL 7 DAY
                                  AND NOT EXISTS (SELECT 1 FROM vacunas n WHERE n.mascota_id = v.mascota_id AND n.tipo = v.tipo AND n.nombre = v.nombre
                                                  AND n.fecha_aplicacion > v.fecha_aplicacion)
                                ORDER BY v.proxima_dosis LIMIT 30")->fetchAll();
        $faltas = $db->query(self::SQL_CITA . " WHERE c.estado = 'no_asistio' AND c.inicio >= CURDATE() - INTERVAL 14 DAY ORDER BY c.inicio DESC LIMIT 20")->fetchAll();
        return [200, [
            'hoy' => ['total' => array_sum($porEstado) - (int) ($porEstado['cancelada'] ?? 0), 'por_estado' => array_map('intval', $porEstado)],
            'pendientes' => array_map(fn($p) => ['fecha' => $p['dia'], 'citas' => (int) $p['n']], $pendientes),
            'vacunas' => $vacunas,
            'faltas' => array_map(fn($c) => self::citaJson($c, true), $faltas),
        ]];
    }

    // ---------- Pacientes e historial clínico ----------

    /**
     * Pacientes para el buscador del panel: todas las mascotas con su última consulta y su próxima cita.
     * El nombre del dueño lo pone el panel con la lista de clientes de auth-service; aquí va el contacto
     * de su última cita (nombre, correo y teléfono que dio al reservar).
     */
    public function pacientes(): array
    {
        Guard::usuario(Guard::CLINICA);
        $q = Db::escritura()->query("SELECT m.id, m.id_cliente, m.nombre, m.especie, m.raza, m.alergias, m.enfermedades_cronicas, m.activa,
                                            (SELECT MAX(h.fecha) FROM historial_clinico h WHERE h.mascota_id = m.id) AS ultima_consulta,
                                            (SELECT MIN(c.inicio) FROM citas c WHERE c.mascota_id = m.id AND c.estado IN ('pendiente','confirmada')
                                                AND c.inicio >= NOW()) AS proxima_cita,
                                            u.cliente_nombre, u.cliente_email, u.telefono
                                       FROM mascotas m
                                       LEFT JOIN citas u ON u.id = (SELECT x.id FROM citas x WHERE x.id_cliente = m.id_cliente ORDER BY x.created_at DESC LIMIT 1)
                                      ORDER BY m.activa DESC, m.nombre LIMIT 2000");
        return [200, ['pacientes' => array_map(fn($m) => [
            'id' => $m['id'], 'nombre' => $m['nombre'], 'especie' => $m['especie'], 'raza' => $m['raza'], 'activa' => (bool) $m['activa'],
            'alergias' => $m['alergias'], 'enfermedades_cronicas' => $m['enfermedades_cronicas'],
            'ultima_consulta' => $m['ultima_consulta'] !== null ? substr($m['ultima_consulta'], 0, 10) : null,
            'proxima_cita' => $m['proxima_cita'] !== null ? str_replace(' ', 'T', substr($m['proxima_cita'], 0, 16)) : null,
            'dueno' => ['id' => (int) $m['id_cliente'], 'nombre' => $m['cliente_nombre'], 'email' => $m['cliente_email'], 'telefono' => $m['telefono']],
        ], $q->fetchAll())]];
    }

    /** Ficha del paciente (solo admin): historial, carné, notas de servicios y citas. Cada lectura queda en la bitácora. */
    public function historialAdmin(string $mascotaId): array
    {
        $claims = Guard::usuario(Guard::VETERINARIO);
        $m = $this->mascotaAdmin($mascotaId);
        $h = $this->historialMascota($mascotaId);
        Auditoria::registrar('HISTORIAL_CONSULTADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['mascota_id' => $mascotaId, 'dueno_id' => (int) $m['id_cliente'], 'consultas' => count($h['consultas'])],
        ]);

        $db = Db::escritura();
        $q = $db->prepare(self::SQL_CITA . ' WHERE c.mascota_id = ? ORDER BY c.inicio DESC LIMIT 50');
        $q->execute([$mascotaId]);
        $citas = array_map(fn($c) => self::citaJson($c, true), $q->fetchAll());
        $q = $db->prepare('SELECT n.*, c.inicio, s.nombre AS servicio_nombre FROM notas_servicio n JOIN citas c ON c.id = n.cita_id
                           JOIN servicios s ON s.slug = c.servicio WHERE n.mascota_id = ? ORDER BY n.created_at DESC');
        $q->execute([$mascotaId]);
        $notas = array_map(fn($n) => [
            'id' => (int) $n['id'], 'cita_id' => $n['cita_id'], 'servicio' => $n['servicio_nombre'], 'texto' => $n['texto'],
            'fecha' => str_replace(' ', 'T', substr($n['inicio'], 0, 16)), 'registrado_por' => self::autor($n),
        ], $q->fetchAll());
        $q = $db->prepare('SELECT cliente_nombre, cliente_email, telefono FROM citas WHERE id_cliente = ? ORDER BY created_at DESC LIMIT 1');
        $q->execute([(int) $m['id_cliente']]);
        $contacto = $q->fetch() ?: [];

        return [200, [
            'mascota' => self::mascotaJson($m) + ['activa' => (bool) $m['activa']],
            'dueno'   => ['id' => (int) $m['id_cliente'], 'nombre' => $contacto['cliente_nombre'] ?? null, 'email' => $contacto['cliente_email'] ?? null,
                          'telefono' => $contacto['telefono'] ?? null],
            'citas'   => $citas,
            'notas'   => $notas,
        ] + $h];
    }

    /** El veterinario actualiza las alertas clínicas (alergias y enfermedades crónicas) de cualquier paciente. */
    public function actualizarAlertas(string $mascotaId): array
    {
        $claims = Guard::usuario(Guard::VETERINARIO);
        $m = $this->mascotaAdmin($mascotaId);
        $d = Http::body();
        Validar::sinAtaques($d);
        $opcional = fn(string $campo) => isset($d[$campo]) && $d[$campo] !== '' ? Validar::texto($d, $campo, 1, 300) : null;
        $nuevo = ['alergias' => $opcional('alergias'), 'enfermedades_cronicas' => $opcional('enfermedades_cronicas')];
        Db::escritura()->prepare('UPDATE mascotas SET alergias = ?, enfermedades_cronicas = ? WHERE id = ?')
            ->execute([$nuevo['alergias'], $nuevo['enfermedades_cronicas'], $mascotaId]);
        $antes = ['alergias' => $m['alergias'], 'enfermedades_cronicas' => $m['enfermedades_cronicas']];
        if ($antes !== $nuevo) {
            Auditoria::registrar('MASCOTA_ACTUALIZADA', 'EXITO', Auditoria::actor($claims) + [
                'dato_anterior' => ['mascota_id' => $mascotaId] + $antes,
                'dato_nuevo'    => ['mascota_id' => $mascotaId] + $nuevo,
            ]);
        }
        return [200, ['mascota' => self::mascotaJson($this->mascotaPorId($mascotaId)) + ['activa' => (bool) $m['activa']]]];
    }

    /**
     * Ficha de una consulta con cita. Si la cita seguía pendiente o confirmada, pasa a atendida en la
     * misma transacción. A.5.34: el diagnóstico no va a la bitácora.
     */
    public function registrarHistorial(string $id): array
    {
        $claims = Guard::usuario(Guard::VETERINARIO);
        $d = Http::body();
        Validar::sinAtaques($d);
        $cita = $this->citaPorId($id) ?? throw new ApiError(404, 'Cita no encontrada');
        if ($cita['servicio'] !== self::SERVICIO_CLINICO) {
            throw new ApiError(422, 'Solo las consultas veterinarias llevan historial clínico');
        }
        $dia = substr($cita['inicio'], 0, 10);
        if ($dia > date('Y-m-d')) {
            throw new ApiError(422, 'La consulta se registra el día de la cita o después');
        }
        $ficha = self::ficha($d, $dia);

        $pesoAnterior = $this->mascotaPorId($cita['mascota_id'])['peso_kg'];
        $db = Db::escritura();
        $historialId = Jwt::uuid();
        $db->beginTransaction();
        try {
            // Bloqueo de la fila: dos admins no registran dos fichas ni pisan un cambio de estado.
            $q = $db->prepare('SELECT estado FROM citas WHERE id = ? FOR UPDATE');
            $q->execute([$id]);
            $anterior = $q->fetchColumn();
            // Una cita cerrada sola como «no asistió» (se olvidó la ficha) todavía se puede registrar.
            if (!in_array($anterior, ['pendiente', 'confirmada', 'atendida', 'no_asistio'], true)) {
                throw new ApiError(409, "Una cita $anterior no lleva historial");
            }
            try {
                $this->insertarFicha($db, $historialId, $id, $cita['mascota_id'], $cita['inicio'], $ficha, $claims);
            } catch (\PDOException $e) {
                if (($e->errorInfo[1] ?? null) === 1062) {
                    throw new ApiError(409, 'Esta consulta ya tiene su historial registrado');
                }
                throw $e;
            }
            if ($anterior !== 'atendida') {
                $db->prepare("UPDATE citas SET estado = 'atendida' WHERE id = ?")->execute([$id]);
                $db->prepare('INSERT INTO historial_citas (cita_id, estado_anterior, estado_nuevo, cambiado_por, comentario) VALUES (?, ?, ?, ?, ?)')
                    ->execute([$id, $anterior, 'atendida', (int) $claims['sub'], 'Consulta registrada en el historial clínico']);
            }
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }

        if ($anterior !== 'atendida') {
            Auditoria::registrar('CITA_ESTADO_CAMBIADO', 'EXITO', Auditoria::actor($claims) + [
                'dato_anterior' => ['cita_id' => $id, 'estado' => $anterior],
                'dato_nuevo'    => ['cita_id' => $id, 'estado' => 'atendida', 'inicio' => $cita['inicio'], 'comentario' => 'Consulta registrada'],
            ]);
        }
        $this->auditarFicha($claims, $historialId, $id, $cita['mascota_id'], $ficha, $pesoAnterior);
        return [201, ['historial' => $this->consultaPorId($cita['mascota_id'], $historialId)]];
    }

    /** Consulta sin cita previa (urgencias o gente que llega sin cita): queda con la fecha y hora de ahora. */
    public function registrarConsultaSinCita(string $mascotaId): array
    {
        $claims = Guard::usuario(Guard::VETERINARIO);
        $d = Http::body();
        Validar::sinAtaques($d);
        $m = $this->mascotaAdmin($mascotaId);
        if (!(int) $m['activa']) {
            throw new ApiError(422, 'Esa mascota ya no está activa');
        }
        $ficha = self::ficha($d, date('Y-m-d'));
        $db = Db::escritura();
        $historialId = Jwt::uuid();
        $db->beginTransaction();
        try {
            $this->insertarFicha($db, $historialId, null, $mascotaId, date('Y-m-d H:i:s'), $ficha, $claims);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        $this->auditarFicha($claims, $historialId, null, $mascotaId, $ficha, $m['peso_kg']);
        return [201, ['historial' => $this->consultaPorId($mascotaId, $historialId)]];
    }

    /** Corrección de una ficha: el original no cambia y la adenda queda a la vista y en la bitácora. */
    public function agregarAdenda(string $historialId): array
    {
        $claims = Guard::usuario(Guard::VETERINARIO);
        $d = Http::body();
        Validar::sinAtaques($d);
        $q = Db::escritura()->prepare('SELECT id, mascota_id, cita_id FROM historial_clinico WHERE id = ?');
        $q->execute([$historialId]);
        $h = preg_match('/^[0-9a-f\-]{36}$/', $historialId) ? $q->fetch() : null;
        if (!$h) {
            throw new ApiError(404, 'Consulta no encontrada');
        }
        $texto = Validar::texto($d, 'texto', 3, 1000);
        $db = Db::escritura();
        $db->prepare('INSERT INTO historial_adendas (historial_id, texto, registrado_por, registrado_email) VALUES (?, ?, ?, ?)')
            ->execute([$historialId, $texto, (int) $claims['sub'], $claims['email']]);
        // A.5.34: el texto de la corrección no va a la bitácora, igual que el diagnóstico.
        Auditoria::registrar('HISTORIAL_CORREGIDO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['adenda_id' => (int) $db->lastInsertId(), 'historial_id' => $historialId, 'cita_id' => $h['cita_id'], 'mascota_id' => $h['mascota_id']],
        ]);
        return [201, $this->historialMascota($h['mascota_id'])];
    }

    /** Vacuna o desparasitación aplicada en otra clínica (o antes de usar el sistema): va al carné sin ficha. */
    public function registrarVacunaExterna(string $mascotaId): array
    {
        $claims = Guard::usuario(Guard::VETERINARIO);
        $d = Http::body();
        Validar::sinAtaques($d);
        $this->mascotaAdmin($mascotaId);
        $aplicacion = $d['fecha_aplicacion'] ?? null;
        $f = is_string($aplicacion) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $aplicacion) : false;
        if (!$f || $f->format('Y-m-d') !== $aplicacion || $f > new \DateTimeImmutable('today') || $f < new \DateTimeImmutable('-30 years')) {
            throw new ApiError(422, 'Fecha de aplicación no válida', ['campo' => 'fecha_aplicacion']);
        }
        $v = self::vacunas([$d], $aplicacion)[0];
        $clinica = isset($d['clinica_externa']) && $d['clinica_externa'] !== '' ? Validar::texto($d, 'clinica_externa', 2, 100) : null;
        $id = Jwt::uuid();
        Db::escritura()->prepare('INSERT INTO vacunas (id, mascota_id, historial_id, tipo, nombre, lote, fecha_aplicacion, proxima_dosis, clinica_externa, registrado_por)
                                  VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, $mascotaId, $v['tipo'], $v['nombre'], $v['lote'], $aplicacion, $v['proxima_dosis'], $clinica, (int) $claims['sub']]);
        Auditoria::registrar('HISTORIAL_REGISTRADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['vacuna_id' => $id, 'mascota_id' => $mascotaId, 'tipo' => $v['tipo'], 'vacunas' => [$v['nombre']], 'externa' => true],
        ]);
        return [201, $this->historialMascota($mascotaId)];
    }

    /** Observación de un servicio no clínico (peluquería, guardería…), p. ej. «se le encontró otitis». */
    public function registrarNota(string $citaId): array
    {
        $claims = Guard::usuario(Guard::CLINICA);
        $d = Http::body();
        Validar::sinAtaques($d);
        $cita = $this->citaPorId($citaId) ?? throw new ApiError(404, 'Cita no encontrada');
        if ($cita['servicio'] === self::SERVICIO_CLINICO) {
            throw new ApiError(422, 'En una consulta, usa la ficha clínica');
        }
        if ($cita['estado'] === 'cancelada') {
            throw new ApiError(409, 'Una cita cancelada no lleva notas');
        }
        $texto = Validar::texto($d, 'texto', 3, 500);
        $db = Db::escritura();
        $db->prepare('INSERT INTO notas_servicio (cita_id, mascota_id, texto, registrado_por, registrado_email) VALUES (?, ?, ?, ?, ?)')
            ->execute([$citaId, $cita['mascota_id'], $texto, (int) $claims['sub'], $claims['email']]);
        Auditoria::registrar('HISTORIAL_REGISTRADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['nota_id' => (int) $db->lastInsertId(), 'cita_id' => $citaId, 'mascota_id' => $cita['mascota_id'], 'servicio' => $cita['servicio']],
        ]);
        return [201, ['ok' => true]];
    }

    /** Firma para subir un resultado o una radiografía a Cloudinary (privado). */
    public function firmaAdjunto(): array
    {
        Guard::usuario(Guard::VETERINARIO);
        return [200, Adjuntos::firma()];
    }

    /** Registra en la ficha un archivo ya subido con firmaAdjunto(). */
    public function registrarAdjunto(string $historialId): array
    {
        $claims = Guard::usuario(Guard::VETERINARIO);
        $d = Http::body();
        Validar::sinAtaques($d);
        $q = Db::escritura()->prepare('SELECT id, mascota_id FROM historial_clinico WHERE id = ?');
        $q->execute([$historialId]);
        $h = preg_match('/^[0-9a-f\-]{36}$/', $historialId) ? $q->fetch() : null;
        if (!$h) {
            throw new ApiError(404, 'Consulta no encontrada');
        }
        $publicId = $d['public_id'] ?? null;
        if (!is_string($publicId) || !preg_match('#^' . preg_quote(Adjuntos::CARPETA, '#') . '/[A-Za-z0-9_.\-]{1,150}$#', $publicId)) {
            throw new ApiError(422, 'El archivo debe subirse con la firma del historial', ['campo' => 'public_id']);
        }
        $recurso = in_array($d['recurso'] ?? null, ['image', 'raw'], true) ? $d['recurso'] : throw new ApiError(422, 'Tipo de archivo no válido', ['campo' => 'recurso']);
        $formato = isset($d['formato']) && $d['formato'] !== '' ? $d['formato'] : null;
        if ($formato !== null && (!is_string($formato) || !preg_match('/^[a-z0-9]{2,5}$/', $formato))) {
            throw new ApiError(422, 'Formato no válido', ['campo' => 'formato']);
        }
        $tipo = in_array($d['tipo'] ?? 'otro', ['laboratorio', 'radiografia', 'otro'], true) ? ($d['tipo'] ?? 'otro') : throw new ApiError(422, 'Tipo no válido', ['campo' => 'tipo']);
        $nombre = Validar::texto($d, 'nombre', 2, 120);
        $db = Db::escritura();
        $db->prepare('INSERT INTO historial_adjuntos (historial_id, nombre, tipo, public_id, recurso, formato, registrado_por, registrado_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$historialId, $nombre, $tipo, $publicId, $recurso, $formato, (int) $claims['sub'], $claims['email']]);
        Auditoria::registrar('HISTORIAL_REGISTRADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['adjunto_id' => (int) $db->lastInsertId(), 'historial_id' => $historialId, 'mascota_id' => $h['mascota_id'], 'tipo' => $tipo],
        ]);
        return [201, $this->historialMascota($h['mascota_id'])];
    }

    /** Carné de vacunas para el dueño: solo lectura y sin diagnósticos. */
    public function carne(string $mascotaId): array
    {
        $claims = Guard::usuario(['cliente', ...Guard::CLINICA]);
        $m = $this->mascotaPropia($mascotaId, $claims, 'carné de vacunas');
        return [200, ['mascota' => self::mascotaJson($m), 'vacunas' => $this->historialMascota($mascotaId)['vacunas']]];
    }

    private function insertarFicha(\PDO $db, string $id, ?string $citaId, string $mascotaId, string $fecha, array $f, array $claims): void
    {
        $db->prepare('INSERT INTO historial_clinico (id, cita_id, mascota_id, fecha, motivo, anamnesis, peso_kg, temperatura_c, frecuencia_cardiaca,
                          frecuencia_respiratoria, mucosas, hidratacion, condicion_corporal, diagnostico, tratamiento, indicaciones, proximo_control,
                          registrado_por, registrado_email)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, $citaId, $mascotaId, $fecha, $f['motivo'], $f['anamnesis'], $f['peso_kg'], $f['temperatura_c'], $f['frecuencia_cardiaca'],
                       $f['frecuencia_respiratoria'], $f['mucosas'], $f['hidratacion'], $f['condicion_corporal'], $f['diagnostico'], $f['tratamiento'],
                       $f['indicaciones'], $f['proximo_control'], (int) $claims['sub'], $claims['email']]);
        $insMed = $db->prepare('INSERT INTO medicamentos (historial_id, nombre, dosis, frecuencia, duracion) VALUES (?, ?, ?, ?, ?)');
        foreach ($f['medicamentos'] as $med) {
            $insMed->execute([$id, $med['nombre'], $med['dosis'], $med['frecuencia'], $med['duracion']]);
        }
        $insVacuna = $db->prepare('INSERT INTO vacunas (id, mascota_id, historial_id, tipo, nombre, lote, fecha_aplicacion, proxima_dosis, registrado_por)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($f['vacunas'] as $v) {
            $insVacuna->execute([Jwt::uuid(), $mascotaId, $id, $v['tipo'], $v['nombre'], $v['lote'], substr($fecha, 0, 10), $v['proxima_dosis'], (int) $claims['sub']]);
        }
        if ($f['peso_kg'] !== null) {
            $db->prepare('UPDATE mascotas SET peso_kg = ? WHERE id = ?')->execute([$f['peso_kg'], $mascotaId]);
        }
    }

    private function auditarFicha(array $claims, string $historialId, ?string $citaId, string $mascotaId, array $f, mixed $pesoAnterior): void
    {
        Auditoria::registrar('HISTORIAL_REGISTRADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => $f['peso_kg'] !== null ? ['mascota_id' => $mascotaId, 'peso_kg' => $pesoAnterior !== null ? (float) $pesoAnterior : null] : null,
            'dato_nuevo'    => ['historial_id' => $historialId, 'cita_id' => $citaId, 'mascota_id' => $mascotaId, 'peso_kg' => $f['peso_kg'],
                                'vacunas' => array_column($f['vacunas'], 'nombre'), 'medicamentos' => count($f['medicamentos']),
                                'sin_cita' => $citaId === null],
        ]);
    }

    private function consultaPorId(string $mascotaId, string $historialId): ?array
    {
        return array_values(array_filter($this->historialMascota($mascotaId)['consultas'], fn($c) => $c['id'] === $historialId))[0] ?? null;
    }

    private function historialMascota(string $mascotaId): array
    {
        $db = Db::escritura();
        $q = $db->prepare('SELECT h.*, s.nombre AS servicio_nombre FROM historial_clinico h LEFT JOIN citas c ON c.id = h.cita_id
                           LEFT JOIN servicios s ON s.slug = c.servicio WHERE h.mascota_id = ? ORDER BY h.fecha DESC, h.created_at DESC');
        $q->execute([$mascotaId]);
        $consultas = $q->fetchAll();
        $q = $db->prepare('SELECT * FROM vacunas WHERE mascota_id = ? ORDER BY fecha_aplicacion DESC, created_at DESC, nombre');
        $q->execute([$mascotaId]);
        $vacunas = $q->fetchAll();
        $q = $db->prepare('SELECT d.* FROM medicamentos d JOIN historial_clinico h ON h.id = d.historial_id WHERE h.mascota_id = ? ORDER BY d.id');
        $q->execute([$mascotaId]);
        $medicamentos = [];
        foreach ($q->fetchAll() as $d) {
            $medicamentos[$d['historial_id']][] = ['nombre' => $d['nombre'], 'dosis' => $d['dosis'], 'frecuencia' => $d['frecuencia'], 'duracion' => $d['duracion']];
        }
        $q = $db->prepare('SELECT a.* FROM historial_adjuntos a JOIN historial_clinico h ON h.id = a.historial_id WHERE h.mascota_id = ? ORDER BY a.id');
        $q->execute([$mascotaId]);
        $adjuntos = [];
        $firmar = Adjuntos::configurado();
        foreach ($q->fetchAll() as $a) {
            $adjuntos[$a['historial_id']][] = ['id' => (int) $a['id'], 'nombre' => $a['nombre'], 'tipo' => $a['tipo'], 'formato' => $a['formato'],
                'url' => $firmar ? Adjuntos::enlace($a['public_id'], $a['recurso'], $a['formato']) : null];
        }
        $q = $db->prepare('SELECT a.* FROM historial_adendas a JOIN historial_clinico h ON h.id = a.historial_id WHERE h.mascota_id = ? ORDER BY a.id');
        $q->execute([$mascotaId]);
        $adendas = [];
        foreach ($q->fetchAll() as $a) {
            $adendas[$a['historial_id']][] = ['id' => (int) $a['id'], 'texto' => $a['texto'], 'fecha' => str_replace(' ', 'T', substr($a['created_at'], 0, 16)),
                                              'registrado_por' => self::autor($a)];
        }

        $hoy = date('Y-m-d');
        $enSemana = date('Y-m-d', strtotime('+7 days'));
        $vacunaJson = fn($v) => [
            'id' => $v['id'], 'tipo' => $v['tipo'], 'nombre' => $v['nombre'], 'lote' => $v['lote'], 'fecha_aplicacion' => $v['fecha_aplicacion'],
            'proxima_dosis' => $v['proxima_dosis'], 'clinica_externa' => $v['clinica_externa'],
            'estado' => $v['proxima_dosis'] === null ? 'sin_refuerzo' : ($v['proxima_dosis'] < $hoy ? 'vencida' : ($v['proxima_dosis'] <= $enSemana ? 'por_vencer' : 'vigente')),
        ];
        // Vienen de la más reciente a la más antigua: si una vacuna ya apareció, esta dosis fue renovada.
        $vistas = [];
        $lista = [];
        $porHistorial = [];
        foreach ($vacunas as $v) {
            $j = $vacunaJson($v);
            $clave = $v['tipo'] . '|' . mb_strtolower($v['nombre']);
            if (isset($vistas[$clave])) {
                $j['estado'] = 'renovada';
            }
            $vistas[$clave] = true;
            $lista[] = $j;
            if ($v['historial_id'] !== null) {
                $porHistorial[$v['historial_id']][] = $j;
            }
        }
        $entero = fn($v) => $v !== null ? (int) $v : null;
        return [
            'consultas' => array_map(fn($h) => [
                'id' => $h['id'], 'cita_id' => $h['cita_id'], 'fecha' => str_replace(' ', 'T', substr($h['fecha'], 0, 16)),
                'servicio' => $h['servicio_nombre'], 'sin_cita' => $h['cita_id'] === null,
                'motivo' => $h['motivo'], 'anamnesis' => $h['anamnesis'],
                'peso_kg' => $h['peso_kg'] !== null ? (float) $h['peso_kg'] : null,
                'temperatura_c' => $h['temperatura_c'] !== null ? (float) $h['temperatura_c'] : null,
                'frecuencia_cardiaca' => $entero($h['frecuencia_cardiaca']), 'frecuencia_respiratoria' => $entero($h['frecuencia_respiratoria']),
                'mucosas' => $h['mucosas'], 'hidratacion' => $h['hidratacion'], 'condicion_corporal' => $entero($h['condicion_corporal']),
                'diagnostico' => $h['diagnostico'], 'tratamiento' => $h['tratamiento'], 'indicaciones' => $h['indicaciones'],
                'proximo_control' => $h['proximo_control'],
                'medicamentos' => $medicamentos[$h['id']] ?? [],
                'vacunas' => $porHistorial[$h['id']] ?? [],
                'adendas' => $adendas[$h['id']] ?? [],
                'adjuntos' => $adjuntos[$h['id']] ?? [],
                'registrado_por' => self::autor($h),
            ], $consultas),
            'vacunas' => $lista,
        ];
    }

    /** Quién registró algo: su correo, o su id en los registros anteriores a que se guardara el correo. */
    private static function autor(array $fila): string
    {
        return $fila['registrado_email'] ?? 'Usuario #' . $fila['registrado_por'];
    }

    /** Valida la ficha clínica completa. Solo el diagnóstico es obligatorio. */
    private static function ficha(array $d, string $dia): array
    {
        $numero = function (string $campo, float $min, float $max, string $error, bool $entero = false) use ($d): int|float|null {
            $v = $d[$campo] ?? null;
            if ($v === null || $v === '') {
                return null;
            }
            if (!is_numeric($v) || (float) $v < $min || (float) $v > $max || ($entero && (float) $v != (int) $v)) {
                throw new ApiError(422, $error, ['campo' => $campo]);
            }
            return $entero ? (int) $v : round((float) $v, $campo === 'peso_kg' ? 2 : 1);
        };
        $opcional = fn(string $campo, int $max) => isset($d[$campo]) && $d[$campo] !== '' ? Validar::texto($d, $campo, 1, $max) : null;
        $opcion = function (string $campo, array $validas) use ($d): ?string {
            $v = $d[$campo] ?? null;
            if ($v === null || $v === '') {
                return null;
            }
            return in_array($v, $validas, true) ? $v : throw new ApiError(422, "Valor no válido en $campo", ['campo' => $campo]);
        };

        $control = $d['proximo_control'] ?? null;
        if ($control !== null && $control !== '') {
            $f = is_string($control) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $control) : false;
            $limite = (new \DateTimeImmutable($dia))->modify('+1 year')->format('Y-m-d');
            if (!$f || $f->format('Y-m-d') !== $control || $control <= $dia || $control > $limite) {
                throw new ApiError(422, 'El próximo control debe ser después de la consulta y dentro de un año', ['campo' => 'proximo_control']);
            }
        }

        return [
            'motivo'                  => $opcional('motivo', 200),
            'anamnesis'               => $opcional('anamnesis', 1000),
            'peso_kg'                 => $numero('peso_kg', 0.01, 150, 'Peso no válido'),
            'temperatura_c'           => $numero('temperatura_c', 30, 45, 'Temperatura no válida (30 a 45 °C)'),
            'frecuencia_cardiaca'     => $numero('frecuencia_cardiaca', 10, 400, 'Frecuencia cardíaca no válida', true),
            'frecuencia_respiratoria' => $numero('frecuencia_respiratoria', 4, 200, 'Frecuencia respiratoria no válida', true),
            'mucosas'                 => $opcion('mucosas', self::MUCOSAS),
            'hidratacion'             => $opcion('hidratacion', self::HIDRATACION),
            'condicion_corporal'      => $numero('condicion_corporal', 1, 9, 'Condición corporal: de 1 a 9', true),
            'diagnostico'             => Validar::texto($d, 'diagnostico', 3, 1000),
            'tratamiento'             => $opcional('tratamiento', 500),
            'indicaciones'            => $opcional('indicaciones', 1000),
            'proximo_control'         => $control ?: null,
            'medicamentos'            => self::medicamentos($d['medicamentos'] ?? []),
            'vacunas'                 => self::vacunas($d['vacunas'] ?? [], $dia),
        ];
    }

    /** @return list<array{nombre: string, dosis: ?string, frecuencia: ?string, duracion: ?string}> */
    private static function medicamentos(mixed $lista): array
    {
        if (!is_array($lista) || !array_is_list($lista) || count($lista) > self::MAX_MEDICAMENTOS) {
            throw new ApiError(422, 'Hasta ' . self::MAX_MEDICAMENTOS . ' medicamentos por consulta', ['campo' => 'medicamentos']);
        }
        return array_map(function ($m) {
            if (!is_array($m)) {
                throw new ApiError(422, 'Medicamento no válido', ['campo' => 'medicamentos']);
            }
            $opcional = fn(string $campo) => isset($m[$campo]) && $m[$campo] !== '' ? Validar::texto($m, $campo, 1, 60) : null;
            return ['nombre' => Validar::texto($m, 'nombre', 2, 80), 'dosis' => $opcional('dosis'), 'frecuencia' => $opcional('frecuencia'),
                    'duracion' => $opcional('duracion')];
        }, $lista);
    }

    /** @return list<array{tipo: string, nombre: string, lote: ?string, proxima_dosis: ?string}> */
    private static function vacunas(mixed $lista, string $aplicacion): array
    {
        if (!is_array($lista) || !array_is_list($lista) || count($lista) > self::MAX_VACUNAS) {
            throw new ApiError(422, 'Hasta ' . self::MAX_VACUNAS . ' vacunas por consulta', ['campo' => 'vacunas']);
        }
        $limite = (new \DateTimeImmutable($aplicacion))->modify('+3 years')->format('Y-m-d');
        return array_map(function ($v) use ($aplicacion, $limite) {
            if (!is_array($v)) {
                throw new ApiError(422, 'Vacuna no válida', ['campo' => 'vacunas']);
            }
            $tipo = $v['tipo'] ?? 'vacuna';
            if (!in_array($tipo, self::TIPOS_VACUNA, true)) {
                throw new ApiError(422, 'Tipo no válido: vacuna o desparasitación', ['campo' => 'tipo']);
            }
            $proxima = $v['proxima_dosis'] ?? null;
            if ($proxima !== null && $proxima !== '') {
                $f = is_string($proxima) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $proxima) : false;
                if (!$f || $f->format('Y-m-d') !== $proxima || $proxima <= $aplicacion || $proxima > $limite) {
                    throw new ApiError(422, 'La próxima dosis debe ser después de la aplicación y dentro de 3 años', ['campo' => 'proxima_dosis']);
                }
            }
            return [
                'tipo' => $tipo,
                'nombre' => Validar::texto($v, 'nombre', 2, 80),
                'lote' => isset($v['lote']) && $v['lote'] !== '' ? Validar::texto($v, 'lote', 1, 40) : null,
                'proxima_dosis' => $proxima ?: null,
            ];
        }, $lista);
    }

    private function mascotaAdmin(string $id): array
    {
        $m = preg_match('/^[0-9a-f\-]{36}$/', $id) ? $this->mascotaPorId($id) : null;
        return $m ?: throw new ApiError(404, 'Mascota no encontrada');
    }

    // ---------- Apoyo ----------

    private const SQL_CITA = 'SELECT c.*, m.nombre AS mascota_nombre, m.especie, m.raza, m.notas AS mascota_notas, m.alergias, m.enfermedades_cronicas,
                                     s.nombre AS servicio_nombre, s.modalidad, pr.nombre AS profesional_nombre,
                                     h.id AS historial_id
                                FROM citas c JOIN mascotas m ON m.id = c.mascota_id JOIN servicios s ON s.slug = c.servicio
                                LEFT JOIN profesionales pr ON pr.servicio = c.servicio AND pr.id = c.cupo
                                LEFT JOIN historial_clinico h ON h.cita_id = c.id';

    /** Cambio de estado con bloqueo de fila: dos personas no pisan el mismo cambio. */
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
            try {
                $db->prepare('UPDATE citas SET estado = ? WHERE id = ?')->execute([$nuevo, $cita['id']]);
            } catch (\PDOException $e) {
                // Reactivar una cancelada vuelve a ocupar su cupo: si otra cita lo tomó, el índice único lo impide.
                if (($e->errorInfo[1] ?? null) === 1062) {
                    throw new ApiError(409, 'Ese turno ya lo ocupa otra cita: reprográmala en vez de reactivarla');
                }
                throw $e;
            }
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

    /**
     * Ocupación de un servicio entre dos días (inclusive) y bloqueos de su sede, en dos consultas.
     * En hospedaje cuenta las estadías que pasan cada noche; en el resto, las citas de cada turno.
     * @return array{citas: array<string, int>, bloqueos: array<string, list<array>>}
     */
    private function ocupacion(\PDO $db, array $servicio, string $desde, string $hasta): array
    {
        $citas = [];
        if ($servicio['modalidad'] === 'estadia') {
            $q = $db->prepare('SELECT inicio, fin FROM citas WHERE servicio = ? AND ocupa = 1 AND inicio < ? + INTERVAL 1 DAY AND fin > ?');
            $q->execute([$servicio['slug'], $hasta, $desde]);
            foreach ($q->fetchAll() as $e) {
                for ($n = substr($e['inicio'], 0, 10); "$n 08:00:00" < $e['fin']; $n = date('Y-m-d', strtotime("$n +1 day"))) {
                    $citas["$n 08:00"] = ($citas["$n 08:00"] ?? 0) + 1;
                }
            }
        } else {
            $q = $db->prepare('SELECT DATE_FORMAT(inicio, "%Y-%m-%d %H:%i") AS turno, cupo FROM citas
                               WHERE servicio = ? AND inicio >= ? AND inicio < ? + INTERVAL 1 DAY AND ocupa = 1');
            $q->execute([$servicio['slug'], $desde, $hasta]);
            foreach ($q->fetchAll() as $f) {
                $citas[$f['turno']] = ($citas[$f['turno']] ?? 0) + 1;
                $ocupados[$f['turno']][] = (int) $f['cupo'];
            }
        }
        $q = $db->prepare('SELECT fecha, hora_inicio, hora_fin FROM turnos_bloqueados WHERE sede = ? AND fecha BETWEEN ? AND ? AND activo = 1');
        $q->execute([$servicio['sede'], $desde, $hasta]);
        $bloqueos = [];
        foreach ($q->fetchAll() as $b) {
            $bloqueos[$b['fecha']][] = $b;
        }
        return ['citas' => $citas, 'ocupados' => $ocupados ?? [], 'bloqueos' => $bloqueos];
    }

    /** Ids de los profesionales del servicio que trabajan ese día y hora, sin los de $ocupados. */
    private static function profesionalesDelTurno(array $servicio, string $dia, string $hora, array $ocupados): array
    {
        $n = date('N', strtotime($dia));
        $ids = [];
        foreach ($servicio['profesionales'] as $p) {
            if (in_array($n, explode(',', $p['dias']), true) && "$hora:00" >= $p['hora_inicio'] && "$hora:00" < $p['hora_fin']
                && !in_array((int) $p['id'], $ocupados, true)) {
                $ids[] = (int) $p['id'];
            }
        }
        return $ids;
    }

    /** Profesional pedido (id) si pertenece al servicio; null = cualquiera. */
    private static function profesionalElegido(array $servicio, mixed $valor): ?int
    {
        if ($valor === null || $valor === '' || !$servicio['profesionales']) {
            return null;
        }
        $id = is_int($valor) || (is_string($valor) && ctype_digit($valor)) ? (int) $valor : 0;
        if (!in_array($id, array_map(fn($p) => (int) $p['id'], $servicio['profesionales']), true)) {
            throw new ApiError(422, 'Ese profesional no atiende este servicio', ['campo' => 'profesional_id']);
        }
        return $id;
    }

    /**
     * Turnos de un día con sus cupos libres. Turnos de 30 min; en guardería y hospedaje, uno solo a las
     * 8:00 (la entrada). Con $llenos también los que no tienen cupo; el personal puede agendar el turno
     * en curso (la persona ya está en la clínica), el cliente necesita 1 h de anticipación.
     * @return list<array{hora: string, libres: int}>
     */
    private function turnosDia(array $servicio, string $dia, array $ocupacion, bool $llenos, bool $personal, ?int $profesional = null): array
    {
        if ((int) date('N', strtotime($dia)) === 7) {
            return []; // domingo cerrado
        }
        $horas = [];
        if ($servicio['modalidad'] === 'turno') {
            for ($min = self::APERTURA * 60; $min < self::CIERRE * 60; $min += self::TURNO_MIN) {
                $horas[] = sprintf('%02d:%02d', intdiv($min, 60), $min % 60);
            }
        } else {
            $horas[] = sprintf('%02d:00', self::APERTURA);
        }
        $limite = $personal ? time() - self::TURNO_MIN * 60 : time() + self::ANTICIPACION_MIN * 60;
        $turnos = [];
        foreach ($horas as $hora) {
            // En guardería y hospedaje la entrada es a las 8:00, pero se puede reservar el mismo día hasta el mediodía.
            $corte = $servicio['modalidad'] === 'turno' ? strtotime("$dia $hora:00") : strtotime("$dia 12:00:00");
            if ($corte < $limite) {
                continue;
            }
            foreach ($ocupacion['bloqueos'][$dia] ?? [] as $b) {
                if ($b['hora_inicio'] === null || ("$hora:00" >= $b['hora_inicio'] && "$hora:00" < $b['hora_fin'])) {
                    continue 2;
                }
            }
            if ($servicio['profesionales']) {
                $trabajan = self::profesionalesDelTurno($servicio, $dia, $hora, []);
                if ($profesional !== null) {
                    $trabajan = array_values(array_intersect($trabajan, [$profesional]));
                }
                if (!$trabajan) {
                    continue; // nadie atiende a esa hora: no es un turno
                }
                $tomados = $ocupacion['ocupados']["$dia $hora"] ?? [];
                $ajenos = count(array_diff($tomados, array_map(fn($p) => (int) $p['id'], $servicio['profesionales'])));
                $libres = max(0, count(array_diff($trabajan, $tomados)) - $ajenos);
            } else {
                $libres = (int) $servicio['cupos'] - ($ocupacion['citas']["$dia $hora"] ?? 0);
            }
            if ($libres > 0 || $llenos) {
                $turnos[] = ['hora' => $hora, 'libres' => max(0, $libres)];
            }
        }
        return $turnos;
    }

    /** Lugares de hospedaje libres en todas las noches de la estadía (el mínimo entre ellas). */
    private function libresEstadia(\PDO $db, array $servicio, string $entrada, string $salida, ?string $excluir = null): int
    {
        $ultima = date('Y-m-d', strtotime("$salida -1 day"));
        $ocupacion = $this->ocupacion($db, $servicio, $entrada, $ultima);
        $libres = (int) $servicio['cupos'];
        for ($n = $entrada; $n < $salida; $n = date('Y-m-d', strtotime("$n +1 day"))) {
            $libres = min($libres, (int) $servicio['cupos'] - ($ocupacion['citas']["$n 08:00"] ?? 0));
        }
        return max(0, $libres);
    }

    /** Fecha de salida del hospedaje: después de la entrada y como máximo MAX_NOCHES noches. */
    private static function salida(mixed $valor, \DateTimeImmutable $entrada): string
    {
        $f = is_string($valor) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $valor) : false;
        if (!$f || $f->format('Y-m-d') !== $valor || $f <= $entrada || $f > $entrada->modify('+' . self::MAX_NOCHES . ' days')) {
            throw new ApiError(422, 'La salida debe ser después de la entrada y como máximo ' . self::MAX_NOCHES . ' noches', ['campo' => 'salida']);
        }
        return $valor;
    }

    /** ¿Hay un bloqueo activo sobre ese turno? Lectura con bloqueo: ve lo último confirmado. */
    private function bloqueado(\PDO $db, string $sede, string $dia, string $hora): bool
    {
        $q = $db->prepare('SELECT COUNT(*) FROM turnos_bloqueados WHERE sede = ? AND fecha = ? AND activo = 1
                           AND (hora_inicio IS NULL OR (? >= hora_inicio AND ? < hora_fin)) LOCK IN SHARE MODE');
        $q->execute([$sede, $dia, "$hora:00", "$hora:00"]);
        return (int) $q->fetchColumn() > 0;
    }

    /**
     * Correo de la cita (notificaciones-service). No bloquea: si falla, la cita sigue y la falla queda
     * en la bitácora. La primera respuesta trae el código HMAC, que se guarda para mostrarlo.
     * Devuelve si el correo salió (null si notificaciones-service no respondió).
     */
    public function notificar(string $tipo, array $c, ?string $comentario = null): ?bool
    {
        [$http, $json] = Interno::post(rtrim(Env::get('NOTIFICACIONES_URL', 'http://notificaciones-service:8085'), '/') . '/internal/notificaciones/cita', [
            'tipo'       => $tipo,
            'comentario' => $comentario,
            'cita'       => [
                'id' => $c['id'], 'inicio' => substr($c['inicio'], 0, 16), 'servicio' => $c['servicio_nombre'], 'sede' => self::SEDES[$c['sede']],
                'mascota' => $c['mascota_nombre'], 'cliente_nombre' => $c['cliente_nombre'], 'cliente_email' => $c['cliente_email'],
            ],
        ], 12);
        $codigo = $json['codigo_verificacion'] ?? null;
        if ($http !== 200 || !is_string($codigo) || !preg_match('/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/', $codigo)) {
            error_log("citas: notificaciones respondió $http al avisar la cita {$c['id']} ($tipo)");
            return null;
        }
        if ($c['codigo_verificacion'] === null) {
            Db::escritura()->prepare('UPDATE citas SET codigo_verificacion = ? WHERE id = ? AND codigo_verificacion IS NULL')->execute([$codigo, $c['id']]);
        }
        return ($json['enviado'] ?? false) === true;
    }

    /** Hora «HH:MM» de un turno válido (8:00 a 20:00 cada 30 min; 20:00 solo como fin). */
    private static function horaTurno(mixed $valor, string $campo): string
    {
        if (is_string($valor) && preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/', $valor, $m)) {
            $min = (int) $m[1] * 60 + (int) $m[2];
            if ($min % self::TURNO_MIN === 0 && $min >= self::APERTURA * 60 && $min <= self::CIERRE * 60) {
                return $valor;
            }
        }
        throw new ApiError(422, 'Hora no válida: de 08:00 a 20:00, cada 30 minutos', ['campo' => $campo]);
    }

    private function bloqueoPorId(int $id): ?array
    {
        $q = Db::escritura()->prepare('SELECT * FROM turnos_bloqueados WHERE id = ?');
        $q->execute([$id]);
        return $q->fetch() ?: null;
    }

    private static function bloqueoJson(array $b): array
    {
        return [
            'id' => (int) $b['id'], 'sede' => ['codigo' => $b['sede'], 'nombre' => self::SEDES[$b['sede']]], 'fecha' => $b['fecha'],
            'hora_inicio' => $b['hora_inicio'] !== null ? substr($b['hora_inicio'], 0, 5) : null,
            'hora_fin' => $b['hora_fin'] !== null ? substr($b['hora_fin'], 0, 5) : null,
            'motivo' => $b['motivo'],
        ];
    }

    /** Servicio activo con su modalidad y sus cupos. Del maestro: los cupos deciden reservas. */
    private function servicio(mixed $slug): array
    {
        if (is_string($slug) && preg_match('/^[a-z]{3,30}$/', $slug)) {
            $q = Db::escritura()->prepare('SELECT slug, nombre, sede, modalidad, cupos FROM servicios WHERE slug = ? AND activo = 1');
            $q->execute([$slug]);
            if ($s = $q->fetch()) {
                // Solo los servicios por turnos tienen equipo; sin profesionales activos, cupos numéricos.
                $q = Db::escritura()->prepare('SELECT id, nombre, dias, hora_inicio, hora_fin FROM profesionales WHERE servicio = ? AND activo = 1 ORDER BY id');
                $q->execute([$slug]);
                $s['profesionales'] = $s['modalidad'] === 'turno' ? $q->fetchAll() : [];
                return $s;
            }
        }
        throw new ApiError(422, 'Servicio no válido', ['campo' => 'servicio']);
    }

    private static function sedeFiltro(): ?string
    {
        $sede = $_GET['sede'] ?? null;
        if ($sede === null || $sede === '') {
            return null;
        }
        return is_string($sede) && isset(self::SEDES[$sede]) ? $sede : throw new ApiError(422, 'Sede no válida', ['campo' => 'sede']);
    }

    /** Fecha Y-m-d entre hoy y MAX_DIAS (el personal puede consultar días pasados). */
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
        $esterilizado = $d['esterilizado'] ?? null;
        if ($esterilizado !== null && $esterilizado !== '' && !is_bool($esterilizado)) {
            throw new ApiError(422, 'Indica si está esterilizado', ['campo' => 'esterilizado']);
        }
        $microchip = isset($d['microchip']) && $d['microchip'] !== '' ? $d['microchip'] : null;
        if ($microchip !== null && (!is_string($microchip) || !preg_match('/^[0-9A-Za-z]{9,15}$/', $microchip))) {
            throw new ApiError(422, 'El microchip tiene de 9 a 15 letras o números', ['campo' => 'microchip']);
        }
        $opcional = fn(string $campo, int $max) => isset($d[$campo]) && $d[$campo] !== '' ? Validar::texto($d, $campo, 1, $max) : null;
        return [
            'nombre'           => Validar::texto($d, 'nombre', 1, 60),
            'especie'          => $especie,
            'raza'             => $opcional('raza', 60),
            'sexo'             => $sexo ?: null,
            'esterilizado'     => is_bool($esterilizado) ? (int) $esterilizado : null,
            'color'            => $opcional('color', 40),
            'microchip'        => $microchip,
            'fecha_nacimiento' => $nacimiento ?: null,
            'peso_kg'          => $peso !== null && $peso !== '' ? round((float) $peso, 2) : null,
            'alergias'         => $opcional('alergias', 300),
            'enfermedades_cronicas' => $opcional('enfermedades_cronicas', 300),
            'notas'            => $opcional('notas', 300),
        ];
    }

    private function mascotaPorId(string $id): ?array
    {
        $q = Db::escritura()->prepare('SELECT * FROM mascotas WHERE id = ?');
        $q->execute([$id]);
        return $q->fetch() ?: null;
    }

    private function mascotaPropia(string $id, array $claims, string $recurso = 'mascota'): array
    {
        $m = preg_match('/^[0-9a-f\-]{36}$/', $id) ? $this->mascotaPorId($id) : null;
        if (!$m || (int) $m['id_cliente'] !== (int) $claims['sub']) {
            if ($m) {
                Auditoria::registrar('ACCESO_DENEGADO', 'FALLO', Auditoria::actor($claims) + [
                    'dato_nuevo' => ['recurso' => $recurso, 'mascota_id' => $id, 'motivo' => 'la mascota pertenece a otro cliente'],
                ]);
            }
            throw new ApiError(404, 'Mascota no encontrada', ['campo' => 'mascota_id']);
        }
        return $m;
    }

    public function citaPorId(string $id): ?array
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
        if (!$c || (!in_array($claims['rol'], Guard::CLINICA, true) && (int) $c['id_cliente'] !== (int) $claims['sub'])) {
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
            'esterilizado' => $m['esterilizado'] !== null ? (bool) $m['esterilizado'] : null, 'color' => $m['color'], 'microchip' => $m['microchip'],
            'fecha_nacimiento' => $m['fecha_nacimiento'], 'peso_kg' => $m['peso_kg'] !== null ? (float) $m['peso_kg'] : null,
            'alergias' => $m['alergias'], 'enfermedades_cronicas' => $m['enfermedades_cronicas'], 'notas' => $m['notas'],
        ];
    }

    private static function citaJson(array $c, bool $personal = false): array
    {
        $json = [
            'id'       => $c['id'],
            'estado'   => $c['estado'],
            'inicio'   => str_replace(' ', 'T', substr($c['inicio'], 0, 16)),
            'fin'      => $c['fin'] !== null ? str_replace(' ', 'T', substr($c['fin'], 0, 16)) : null,
            'servicio' => ['slug' => $c['servicio'], 'nombre' => $c['servicio_nombre'], 'modalidad' => $c['modalidad']],
            'sede'     => ['codigo' => $c['sede'], 'nombre' => self::SEDES[$c['sede']]],
            'profesional' => $c['profesional_nombre'],
            'mascota'  => ['id' => $c['mascota_id'], 'nombre' => $c['mascota_nombre'], 'especie' => $c['especie']],
            'notas'    => $c['notas'],
            'codigo_verificacion' => $c['codigo_verificacion'],
            'puede_cancelar' => in_array($c['estado'], ['pendiente', 'confirmada'], true)
                && strtotime($c['inicio']) - time() >= self::CANCELAR_HORAS * 3600,
        ];
        if ($personal) {
            $json['cupo'] = (int) $c['cupo'];
            $json['clinica'] = $c['servicio'] === self::SERVICIO_CLINICO;
            $json['tiene_historial'] = $c['historial_id'] !== null;
            $json['cliente'] = ['id' => (int) $c['id_cliente'], 'nombre' => $c['cliente_nombre'], 'email' => $c['cliente_email'], 'telefono' => $c['telefono']];
            $json['mascota'] += ['raza' => $c['raza'], 'notas' => $c['mascota_notas'], 'alergias' => $c['alergias'],
                                 'enfermedades_cronicas' => $c['enfermedades_cronicas']];
        }
        return $json;
    }
}
