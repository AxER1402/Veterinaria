<?php
declare(strict_types=1);

namespace App;

use Huellitas\Auditoria;
use Huellitas\Db;
use Huellitas\Env;
use Huellitas\Interno;

/**
 * Tarea periódica citas-recordatorios (bin/recordatorios.php):
 * 1. Recordatorio un día antes de la cita, si se reservó con al menos un día de anticipación
 *    (a quien reservó para dentro de unas horas ya le llegó el correo de la reserva).
 * 2. Aviso 7 días antes de que venza una vacuna (solo la última dosis de cada vacuna).
 * 3. Cierra como no_asistio las citas que pasaron sin atenderse. Se deja al admin el día de la
 *    cita y el siguiente para registrar la consulta (CITAS_NO_ASISTIO_DIAS, 1 por defecto).
 * Cada aviso se «reclama» con un UPDATE condicional antes de enviarlo: sale una sola vez aunque
 * corran dos instancias, y si el correo falla no se reintenta cada 15 min (queda FALLO en la bitácora).
 */
final class Recordatorios
{
    private const LOTE = 200;
    private const AVISO_VACUNA_DIAS = 7;

    public function ejecutar(): array
    {
        return [
            'recordatorios_cita' => $this->recordatoriosCita(),
            'avisos_vacuna'      => $this->avisosVacuna(),
            'avisos_control'     => $this->avisosControl(),
            'no_asistio'         => $this->cerrarSinAtender(),
        ];
    }

    private function recordatoriosCita(): array
    {
        $db = Db::escritura();
        $ids = $db->query("SELECT id FROM citas WHERE estado IN ('pendiente','confirmada') AND recordatorio_at IS NULL
                           AND inicio > NOW() AND inicio <= NOW() + INTERVAL 24 HOUR AND created_at <= inicio - INTERVAL 24 HOUR
                           ORDER BY inicio LIMIT " . self::LOTE)->fetchAll(\PDO::FETCH_COLUMN);
        $citas = new CitasController();
        $enviados = [];
        foreach ($ids as $id) {
            if (!$this->reclamar('citas', 'recordatorio_at', $id)) {
                continue;
            }
            $c = $citas->citaPorId($id);
            $enviado = $citas->notificar('recordatorio', $c);
            Auditoria::registrar('RECORDATORIO_ENVIADO', $enviado ? 'EXITO' : 'FALLO', [
                'usuario_id' => (int) $c['id_cliente'], 'usuario_email' => $c['cliente_email'], 'rol' => 'cliente',
                'dato_nuevo' => ['tipo' => 'cita', 'cita_id' => $id, 'inicio' => substr($c['inicio'], 0, 16)]
                    + ($enviado ? [] : ['motivo' => $enviado === null ? 'notificaciones no respondió' : 'el correo no salió']),
            ]);
            $enviados[] = $id;
        }
        return $enviados;
    }

    private function avisosVacuna(): array
    {
        $db = Db::escritura();
        // Si la mascota ya recibió una dosis más nueva de esa vacuna, la anterior no se avisa.
        // El contacto sale de la última cita del dueño: una vacuna de otra clínica o una consulta sin
        // cita no tienen cita propia.
        $q = $db->prepare('SELECT v.id, v.nombre, v.proxima_dosis, m.nombre AS mascota, m.id_cliente, c.cliente_nombre, c.cliente_email
                             FROM vacunas v
                             JOIN mascotas m ON m.id = v.mascota_id AND m.activa = 1
                             JOIN citas c ON c.id = (SELECT u.id FROM citas u WHERE u.id_cliente = m.id_cliente ORDER BY u.created_at DESC LIMIT 1)
                            WHERE v.aviso_at IS NULL AND v.proxima_dosis BETWEEN CURDATE() AND CURDATE() + INTERVAL ? DAY
                              AND NOT EXISTS (SELECT 1 FROM vacunas n WHERE n.mascota_id = v.mascota_id AND n.tipo = v.tipo AND n.nombre = v.nombre
                                                                       AND n.fecha_aplicacion > v.fecha_aplicacion)
                            ORDER BY v.proxima_dosis LIMIT ' . self::LOTE);
        $q->execute([self::AVISO_VACUNA_DIAS]);
        $url = rtrim(Env::get('NOTIFICACIONES_URL', 'http://notificaciones-service:8085'), '/') . '/internal/notificaciones/vacuna';
        $avisos = [];
        foreach ($q->fetchAll() as $v) {
            if (!$this->reclamar('vacunas', 'aviso_at', $v['id'])) {
                continue;
            }
            [$http, $json] = Interno::post($url, [
                'vacuna_id' => $v['id'], 'vacuna' => $v['nombre'], 'proxima_dosis' => $v['proxima_dosis'], 'mascota' => $v['mascota'],
                'cliente_nombre' => $v['cliente_nombre'], 'cliente_email' => $v['cliente_email'], 'sede' => $this->sedeClinica(),
            ], 12);
            $enviado = $http === 200 && ($json['enviado'] ?? false) === true;
            Auditoria::registrar('RECORDATORIO_ENVIADO', $enviado ? 'EXITO' : 'FALLO', [
                'usuario_id' => (int) $v['id_cliente'], 'usuario_email' => $v['cliente_email'], 'rol' => 'cliente',
                'dato_nuevo' => ['tipo' => 'vacuna', 'vacuna_id' => $v['id'], 'vacuna' => $v['nombre'], 'proxima_dosis' => $v['proxima_dosis']]
                    + ($enviado ? [] : ['motivo' => $http === 200 ? 'el correo no salió' : "notificaciones respondió $http"]),
            ]);
            $avisos[] = $v['id'];
        }
        return $avisos;
    }

    /**
     * Aviso 7 días antes del control que el veterinario dejó indicado, si la mascota no tiene ya una
     * consulta agendada ni otra consulta posterior.
     */
    private function avisosControl(): array
    {
        $db = Db::escritura();
        $q = $db->prepare("SELECT h.id, h.proximo_control, m.id AS mascota_id, m.nombre AS mascota, m.id_cliente, c.cliente_nombre, c.cliente_email
                             FROM historial_clinico h
                             JOIN mascotas m ON m.id = h.mascota_id AND m.activa = 1
                             JOIN citas c ON c.id = (SELECT u.id FROM citas u WHERE u.id_cliente = m.id_cliente ORDER BY u.created_at DESC LIMIT 1)
                            WHERE h.control_aviso_at IS NULL AND h.proximo_control BETWEEN CURDATE() AND CURDATE() + INTERVAL ? DAY
                              AND NOT EXISTS (SELECT 1 FROM historial_clinico n WHERE n.mascota_id = h.mascota_id AND n.fecha > h.fecha)
                              AND NOT EXISTS (SELECT 1 FROM citas a WHERE a.mascota_id = h.mascota_id AND a.servicio = 'veterinaria'
                                                                     AND a.estado IN ('pendiente','confirmada') AND a.inicio >= NOW())
                            ORDER BY h.proximo_control LIMIT " . self::LOTE);
        $q->execute([self::AVISO_VACUNA_DIAS]);
        $url = rtrim(Env::get('NOTIFICACIONES_URL', 'http://notificaciones-service:8085'), '/') . '/internal/notificaciones/control';
        $avisos = [];
        foreach ($q->fetchAll() as $h) {
            if (!$this->reclamar('historial_clinico', 'control_aviso_at', $h['id'])) {
                continue;
            }
            [$http, $json] = Interno::post($url, [
                'historial_id' => $h['id'], 'fecha' => $h['proximo_control'], 'mascota' => $h['mascota'],
                'cliente_nombre' => $h['cliente_nombre'], 'cliente_email' => $h['cliente_email'], 'sede' => $this->sedeClinica(),
            ], 12);
            $enviado = $http === 200 && ($json['enviado'] ?? false) === true;
            Auditoria::registrar('RECORDATORIO_ENVIADO', $enviado ? 'EXITO' : 'FALLO', [
                'usuario_id' => (int) $h['id_cliente'], 'usuario_email' => $h['cliente_email'], 'rol' => 'cliente',
                'dato_nuevo' => ['tipo' => 'control', 'historial_id' => $h['id'], 'mascota_id' => $h['mascota_id'], 'fecha' => $h['proximo_control']]
                    + ($enviado ? [] : ['motivo' => $http === 200 ? 'el correo no salió' : "notificaciones respondió $http"]),
            ]);
            $avisos[] = $h['id'];
        }
        return $avisos;
    }

    /** Sede donde se dan las consultas: la dirección que va en los avisos clínicos. */
    private function sedeClinica(): string
    {
        $sede = Db::escritura()->query("SELECT sede FROM servicios WHERE slug = 'veterinaria'")->fetchColumn();
        return $sede ? Sedes::texto($sede) : '';
    }

    private function cerrarSinAtender(): array
    {
        $db = Db::escritura();
        $dias = max(1, (int) Env::get('CITAS_NO_ASISTIO_DIAS', '1'));
        $q = $db->prepare("SELECT id FROM citas WHERE estado IN ('pendiente','confirmada') AND inicio < CURDATE() - INTERVAL ? DAY
                           ORDER BY inicio LIMIT " . self::LOTE);
        $q->execute([$dias]);
        $cerradas = [];
        foreach ($q->fetchAll(\PDO::FETCH_COLUMN) as $id) {
            $db->beginTransaction();
            try {
                $b = $db->prepare('SELECT estado, id_cliente, cliente_email, inicio FROM citas WHERE id = ? FOR UPDATE');
                $b->execute([$id]);
                $c = $b->fetch();
                // El admin pudo atenderla o cancelarla entre la consulta y el bloqueo.
                if (!$c || !in_array($c['estado'], ['pendiente', 'confirmada'], true)) {
                    $db->rollBack();
                    continue;
                }
                $db->prepare("UPDATE citas SET estado = 'no_asistio', cierre_automatico = 1 WHERE id = ?")->execute([$id]);
                $db->prepare('INSERT INTO historial_citas (cita_id, estado_anterior, estado_nuevo, cambiado_por, comentario) VALUES (?, ?, ?, NULL, ?)')
                    ->execute([$id, $c['estado'], 'no_asistio', 'Cierre automático: la cita pasó sin atenderse']);
                $db->commit();
            } catch (\Throwable $e) {
                $db->rollBack();
                error_log("No se pudo cerrar la cita $id: " . $e->getMessage());
                continue;
            }
            Auditoria::registrar('CITA_ESTADO_CAMBIADO', 'EXITO', [
                'usuario_id' => (int) $c['id_cliente'], 'usuario_email' => $c['cliente_email'], 'rol' => 'cliente',
                'dato_anterior' => ['cita_id' => $id, 'estado' => $c['estado']],
                'dato_nuevo'    => ['cita_id' => $id, 'estado' => 'no_asistio', 'inicio' => $c['inicio'], 'origen' => 'cierre automático'],
            ]);
            $cerradas[] = $id;
        }
        return $cerradas;
    }

    /** true solo para la instancia que marcó la fila (las demás la ven ya marcada). */
    private function reclamar(string $tabla, string $columna, string $id): bool
    {
        $q = Db::escritura()->prepare("UPDATE $tabla SET $columna = NOW() WHERE id = ? AND $columna IS NULL");
        $q->execute([$id]);
        return $q->rowCount() === 1;
    }
}
