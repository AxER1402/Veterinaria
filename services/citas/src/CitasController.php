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
    private const SERVICIO_CLINICO = 'veterinaria'; // solo la consulta lleva historial clínico
    private const MAX_VACUNAS = 5;

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

    // ---------- Historial clínico y carné (B1) ----------

    /**
     * Ficha de una consulta: peso, diagnóstico, tratamiento y vacunas. Si la cita seguía pendiente o
     * confirmada, pasa a atendida en la misma transacción. A.5.34: el diagnóstico no va a la bitácora.
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

        $peso = $d['peso_kg'] ?? null;
        if ($peso !== null && $peso !== '' && (!is_numeric($peso) || (float) $peso <= 0 || (float) $peso > 150)) {
            throw new ApiError(422, 'Peso no válido', ['campo' => 'peso_kg']);
        }
        $peso = $peso !== null && $peso !== '' ? round((float) $peso, 2) : null;
        $diagnostico = Validar::texto($d, 'diagnostico', 3, 500);
        $tratamiento = isset($d['tratamiento']) && $d['tratamiento'] !== '' ? Validar::texto($d, 'tratamiento', 1, 500) : null;
        $vacunas = self::vacunas($d['vacunas'] ?? [], $dia);

        $pesoAnterior = $this->mascotaPorId($cita['mascota_id'])['peso_kg'];
        $db = Db::escritura();
        $historialId = Jwt::uuid();
        $db->beginTransaction();
        try {
            // Bloqueo de la fila: dos admins no registran dos fichas ni pisan un cambio de estado.
            $q = $db->prepare('SELECT estado FROM citas WHERE id = ? FOR UPDATE');
            $q->execute([$id]);
            $anterior = $q->fetchColumn();
            if (!in_array($anterior, ['pendiente', 'confirmada', 'atendida'], true)) {
                throw new ApiError(409, "Una cita $anterior no lleva historial");
            }
            try {
                $db->prepare('INSERT INTO historial_clinico (id, cita_id, mascota_id, peso_kg, diagnostico, tratamiento, registrado_por) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    ->execute([$historialId, $id, $cita['mascota_id'], $peso, $diagnostico, $tratamiento, (int) $claims['sub']]);
            } catch (\PDOException $e) {
                if (($e->errorInfo[1] ?? null) === 1062) {
                    throw new ApiError(409, 'Esta consulta ya tiene su historial registrado');
                }
                throw $e;
            }
            $insVacuna = $db->prepare('INSERT INTO vacunas (id, mascota_id, historial_id, nombre, lote, fecha_aplicacion, proxima_dosis) VALUES (?, ?, ?, ?, ?, ?, ?)');
            foreach ($vacunas as $v) {
                $insVacuna->execute([Jwt::uuid(), $cita['mascota_id'], $historialId, $v['nombre'], $v['lote'], $dia, $v['proxima_dosis']]);
            }
            if ($peso !== null) {
                $db->prepare('UPDATE mascotas SET peso_kg = ? WHERE id = ?')->execute([$peso, $cita['mascota_id']]);
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
        Auditoria::registrar('HISTORIAL_REGISTRADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => $peso !== null ? ['mascota_id' => $cita['mascota_id'], 'peso_kg' => $pesoAnterior !== null ? (float) $pesoAnterior : null] : null,
            'dato_nuevo'    => ['historial_id' => $historialId, 'cita_id' => $id, 'mascota_id' => $cita['mascota_id'], 'peso_kg' => $peso,
                                'vacunas' => array_column($vacunas, 'nombre')],
        ]);
        return [201, ['historial' => $this->historialMascota($cita['mascota_id'])['consultas'][0] ?? null]];
    }

    /** Historial completo de una mascota (solo admin). Cada lectura queda en la bitácora. */
    public function historialAdmin(string $mascotaId): array
    {
        $claims = Guard::usuario(['admin']);
        $m = preg_match('/^[0-9a-f\-]{36}$/', $mascotaId) ? $this->mascotaPorId($mascotaId) : null;
        if (!$m) {
            throw new ApiError(404, 'Mascota no encontrada');
        }
        $h = $this->historialMascota($mascotaId);
        Auditoria::registrar('HISTORIAL_CONSULTADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['mascota_id' => $mascotaId, 'dueno_id' => (int) $m['id_cliente'], 'consultas' => count($h['consultas'])],
        ]);
        return [200, ['mascota' => self::mascotaJson($m) + ['activa' => (bool) $m['activa']]] + $h];
    }

    /** Carné de vacunas para el dueño: solo lectura y sin diagnósticos. */
    public function carne(string $mascotaId): array
    {
        $claims = Guard::usuario(['cliente', 'admin']);
        $m = $this->mascotaPropia($mascotaId, $claims, 'carné de vacunas');
        return [200, ['mascota' => self::mascotaJson($m), 'vacunas' => $this->historialMascota($mascotaId)['vacunas']]];
    }

    private function historialMascota(string $mascotaId): array
    {
        $db = Db::escritura();
        $q = $db->prepare('SELECT h.*, c.inicio, c.servicio FROM historial_clinico h JOIN citas c ON c.id = h.cita_id
                           WHERE h.mascota_id = ? ORDER BY c.inicio DESC, h.created_at DESC');
        $q->execute([$mascotaId]);
        $consultas = $q->fetchAll();
        $q = $db->prepare('SELECT * FROM vacunas WHERE mascota_id = ? ORDER BY fecha_aplicacion DESC, nombre');
        $q->execute([$mascotaId]);
        $vacunas = $q->fetchAll();

        $hoy = date('Y-m-d');
        $enSemana = date('Y-m-d', strtotime('+7 days'));
        $vacunaJson = fn($v) => [
            'id' => $v['id'], 'nombre' => $v['nombre'], 'lote' => $v['lote'], 'fecha_aplicacion' => $v['fecha_aplicacion'],
            'proxima_dosis' => $v['proxima_dosis'],
            'estado' => $v['proxima_dosis'] === null ? 'sin_refuerzo' : ($v['proxima_dosis'] < $hoy ? 'vencida' : ($v['proxima_dosis'] <= $enSemana ? 'por_vencer' : 'vigente')),
        ];
        // Vienen de la más reciente a la más antigua: si una vacuna ya apareció, esta dosis fue renovada.
        $vistas = [];
        $lista = [];
        $porHistorial = [];
        foreach ($vacunas as $v) {
            $j = $vacunaJson($v);
            $clave = mb_strtolower($v['nombre']);
            if (isset($vistas[$clave])) {
                $j['estado'] = 'renovada';
            }
            $vistas[$clave] = true;
            $lista[] = $j;
            $porHistorial[$v['historial_id']][] = $j;
        }
        return [
            'consultas' => array_map(fn($h) => [
                'id' => $h['id'], 'cita_id' => $h['cita_id'], 'fecha' => str_replace(' ', 'T', substr($h['inicio'], 0, 16)),
                'peso_kg' => $h['peso_kg'] !== null ? (float) $h['peso_kg'] : null, 'diagnostico' => $h['diagnostico'], 'tratamiento' => $h['tratamiento'],
                'vacunas' => $porHistorial[$h['id']] ?? [],
            ], $consultas),
            'vacunas' => $lista,
        ];
    }

    /** @return list<array{nombre: string, lote: ?string, proxima_dosis: ?string}> */
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
            $proxima = $v['proxima_dosis'] ?? null;
            if ($proxima !== null && $proxima !== '') {
                $f = is_string($proxima) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $proxima) : false;
                if (!$f || $f->format('Y-m-d') !== $proxima || $proxima <= $aplicacion || $proxima > $limite) {
                    throw new ApiError(422, 'La próxima dosis debe ser después de la aplicación y dentro de 3 años', ['campo' => 'proxima_dosis']);
                }
            }
            return [
                'nombre' => Validar::texto($v, 'nombre', 2, 80),
                'lote' => isset($v['lote']) && $v['lote'] !== '' ? Validar::texto($v, 'lote', 1, 40) : null,
                'proxima_dosis' => $proxima ?: null,
            ];
        }, $lista);
    }

    // ---------- Apoyo ----------

    private const SQL_CITA = 'SELECT c.*, m.nombre AS mascota_nombre, m.especie, m.raza, m.notas AS mascota_notas, s.nombre AS servicio_nombre,
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
            'codigo_verificacion' => $c['codigo_verificacion'],
            'puede_cancelar' => in_array($c['estado'], ['pendiente', 'confirmada'], true)
                && strtotime($c['inicio']) - time() >= self::CANCELAR_HORAS * 3600,
        ];
        if ($admin) {
            $json['cupo'] = (int) $c['cupo'];
            $json['clinica'] = $c['servicio'] === self::SERVICIO_CLINICO;
            $json['tiene_historial'] = $c['historial_id'] !== null;
            $json['cliente'] = ['id' => (int) $c['id_cliente'], 'nombre' => $c['cliente_nombre'], 'email' => $c['cliente_email'], 'telefono' => $c['telefono']];
            $json['mascota'] += ['raza' => $c['raza'], 'notas' => $c['mascota_notas']];
        }
        return $json;
    }
}
