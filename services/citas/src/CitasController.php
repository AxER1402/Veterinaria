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
    private const APERTURA = 8;          // lunes a sábado, 8:00–20:00
    private const CIERRE = 20;
    private const TURNO_MIN = 30;
    private const ANTICIPACION_MIN = 60; // no se reserva un turno que empieza en menos de 1 h
    private const MAX_DIAS = 60;
    private const CANCELAR_HORAS = 2;
    private const MAX_ACTIVAS = 5;       // D de STRIDE: un cliente no puede acaparar la agenda
    private const ESPECIES = ['perro', 'gato', 'otro'];
    private const SERVICIO_CLINICO = 'veterinaria'; // solo la consulta lleva historial clínico
    private const MAX_VACUNAS = 20;      // tope de cordura por consulta, no una regla clínica
    private const MAX_MEDICAMENTOS = 15;
    private const MUCOSAS = ['rosadas', 'palidas', 'ictericas', 'cianoticas', 'congestivas'];
    private const HIDRATACION = ['normal', 'leve', 'moderada', 'severa']; // deshidratación
    private const TIPOS_VACUNA = ['vacuna', 'desparasitacion'];

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
        Db::escritura()->prepare('INSERT INTO mascotas (id, id_cliente, nombre, especie, raza, sexo, fecha_nacimiento, peso_kg, alergias, enfermedades_cronicas, notas)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, (int) $claims['sub'], $m['nombre'], $m['especie'], $m['raza'], $m['sexo'], $m['fecha_nacimiento'], $m['peso_kg'],
                       $m['alergias'], $m['enfermedades_cronicas'], $m['notas']]);

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
        Db::escritura()->prepare('UPDATE mascotas SET nombre = ?, especie = ?, raza = ?, sexo = ?, fecha_nacimiento = ?, peso_kg = ?, alergias = ?,
                                  enfermedades_cronicas = ?, notas = ? WHERE id = ?')
            ->execute([$m['nombre'], $m['especie'], $m['raza'], $m['sexo'], $m['fecha_nacimiento'], $m['peso_kg'], $m['alergias'],
                       $m['enfermedades_cronicas'], $m['notas'], $id]);

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
        $turno = array_values(array_filter($this->turnos($servicio['sede'], $fecha, $db, true), fn($t) => $t['hora'] === $hora))[0] ?? null;
        if ($turno === null) {
            throw new ApiError(422, 'Ese turno no está disponible', ['campo' => 'hora']);
        }
        if ($turno['libres'] === 0) {
            throw new ApiError(409, 'Ese turno se acaba de llenar. Elige otro');
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
        $db->beginTransaction();
        try {
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
            // Si el admin bloqueó el turno mientras tanto, bloquear() tenía el rango y este INSERT esperó a
            // que terminara: la lectura con bloqueo ya ve el bloqueo confirmado y la reserva se deshace.
            if ($this->bloqueado($db, $servicio['sede'], $fecha->format('Y-m-d'), $hora)) {
                throw new ApiError(422, 'Ese turno no está disponible', ['campo' => 'hora']);
            }
            $db->prepare('INSERT INTO historial_citas (cita_id, estado_anterior, estado_nuevo, cambiado_por, comentario) VALUES (?, NULL, ?, ?, ?)')
                ->execute([$id, 'pendiente', (int) $claims['sub'], 'Cita reservada por el cliente']);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }

        Auditoria::registrar('CITA_CREADA', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['cita_id' => $id, 'servicio' => $servicio['slug'], 'sede' => $servicio['sede'], 'inicio' => $inicio,
                             'mascota_id' => $mascota['id']],
        ]);
        $this->notificar('reservada', $this->citaPorId($id));
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
        $citas = array_map(fn($c) => self::citaJson($c, true), $q->fetchAll());

        $b = Db::escritura()->prepare('SELECT * FROM turnos_bloqueados WHERE activo = 1 AND fecha = ?' . ($sede ? ' AND sede = ?' : '') . ' ORDER BY sede, hora_inicio');
        $b->execute($sede ? [$fecha->format('Y-m-d'), $sede] : [$fecha->format('Y-m-d')]);
        return [200, ['fecha' => $fecha->format('Y-m-d'), 'citas' => $citas, 'bloqueos' => array_map(fn($x) => self::bloqueoJson($x), $b->fetchAll())]];
    }

    /** Próximos bloqueos (feriados, mantenimiento). */
    public function bloqueos(): array
    {
        Guard::usuario(['admin']);
        $q = Db::escritura()->query('SELECT * FROM turnos_bloqueados WHERE activo = 1 AND fecha >= CURDATE() ORDER BY fecha, sede, hora_inicio LIMIT 100');
        return [200, ['bloqueos' => array_map(fn($x) => self::bloqueoJson($x), $q->fetchAll())]];
    }

    /**
     * Bloquea un día entero o un rango de turnos de una sede. Si ya hay citas activas en ese rango se
     * rechaza (409): primero se cancelan en la agenda, y así cada cliente recibe su aviso.
     */
    public function bloquear(): array
    {
        $claims = Guard::usuario(['admin']);
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
        $desde = $todoElDia ? "$dia 00:00:00" : "$dia $ini:00";
        $hasta = $todoElDia ? $fecha->modify('+1 day')->format('Y-m-d 00:00:00') : "$dia $fin:00";

        $db = Db::escritura();
        $db->beginTransaction();
        try {
            // FOR UPDATE toma el rango del índice: una reserva en ese rango espera a que esto termine.
            $q = $db->prepare("SELECT COUNT(*) FROM citas WHERE inicio >= ? AND inicio < ? AND sede = ? AND estado IN ('pendiente','confirmada') FOR UPDATE");
            $q->execute([$desde, $hasta, $sede]);
            $activas = (int) $q->fetchColumn();
            if ($activas > 0) {
                throw new ApiError(409, $activas === 1 ? 'Hay 1 cita en ese horario. Cancélala primero en la agenda'
                    : "Hay $activas citas en ese horario. Cancélalas primero en la agenda", ['citas' => $activas]);
            }
            $db->prepare('INSERT INTO turnos_bloqueados (sede, fecha, hora_inicio, hora_fin, motivo, creado_por) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$sede, $dia, $ini ? "$ini:00" : null, $fin ? "$fin:00" : null, $motivo, (int) $claims['sub']]);
            $id = (int) $db->lastInsertId();
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        $bloqueo = self::bloqueoJson($this->bloqueoPorId($id));
        Auditoria::registrar('TURNO_BLOQUEADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['bloqueo_id' => $id, 'sede' => $sede, 'fecha' => $dia, 'hora_inicio' => $ini, 'hora_fin' => $fin, 'motivo' => $motivo],
        ]);
        return [201, ['bloqueo' => $bloqueo]];
    }

    public function desbloquear(string $id): array
    {
        $claims = Guard::usuario(['admin']);
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
        if (in_array($nuevo, ['confirmada', 'cancelada'], true) && $cita['inicio'] > date('Y-m-d H:i:s')) {
            $this->notificar($nuevo, $this->citaPorId($id), $comentario);
        }
        return [200, ['cita' => self::citaJson($this->citaPorId($id), true)]];
    }

    // ---------- Pacientes e historial clínico ----------

    /**
     * Pacientes para el buscador del panel: todas las mascotas con su última consulta y su próxima cita.
     * El nombre del dueño lo pone el panel con la lista de clientes de auth-service; aquí va el contacto
     * de su última cita (nombre, correo y teléfono que dio al reservar).
     */
    public function pacientes(): array
    {
        Guard::usuario(['admin']);
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
        $claims = Guard::usuario(['admin']);
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
        $claims = Guard::usuario(['admin']);
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
        $claims = Guard::usuario(['admin']);
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
        $claims = Guard::usuario(['admin']);
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
        $claims = Guard::usuario(['admin']);
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
        $claims = Guard::usuario(['admin']);
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
        $claims = Guard::usuario(['admin']);
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

    /** Carné de vacunas para el dueño: solo lectura y sin diagnósticos. */
    public function carne(string $mascotaId): array
    {
        $claims = Guard::usuario(['cliente', 'admin']);
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
                                     s.nombre AS servicio_nombre,
                                     h.id AS historial_id
                                FROM citas c JOIN mascotas m ON m.id = c.mascota_id JOIN servicios s ON s.slug = c.servicio
                                LEFT JOIN historial_clinico h ON h.cita_id = c.id';

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

    /** @return list<array{hora: string, libres: int}> Con $llenos también los turnos sin cupo (libres = 0). */
    private function turnos(string $sede, \DateTimeImmutable $fecha, \PDO $db, bool $llenos = false): array
    {
        if ((int) $fecha->format('N') === 7) {
            return []; // domingo cerrado
        }
        $dia = $fecha->format('Y-m-d');
        $q = $db->prepare('SELECT DATE_FORMAT(inicio, "%H:%i") AS hora, COUNT(*) AS n FROM citas
                           WHERE sede = ? AND inicio >= ? AND inicio < ? + INTERVAL 1 DAY AND ocupa = 1 GROUP BY inicio');
        $q->execute([$sede, $dia, $dia]);
        $ocupados = array_column($q->fetchAll(), 'n', 'hora');

        $q = $db->prepare('SELECT hora_inicio, hora_fin FROM turnos_bloqueados WHERE sede = ? AND fecha = ? AND activo = 1');
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
            if ($libres > 0 || $llenos) {
                $turnos[] = ['hora' => $hora, 'libres' => max(0, $libres)];
            }
        }
        return $turnos;
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
            'fecha_nacimiento' => $m['fecha_nacimiento'], 'peso_kg' => $m['peso_kg'] !== null ? (float) $m['peso_kg'] : null,
            'alergias' => $m['alergias'], 'enfermedades_cronicas' => $m['enfermedades_cronicas'], 'notas' => $m['notas'],
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
            'codigo_verificacion' => $c['codigo_verificacion'],
            'puede_cancelar' => in_array($c['estado'], ['pendiente', 'confirmada'], true)
                && strtotime($c['inicio']) - time() >= self::CANCELAR_HORAS * 3600,
        ];
        if ($admin) {
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
