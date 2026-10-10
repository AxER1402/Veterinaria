<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Db;
use Huellitas\Guard;
use Huellitas\Http;

/**
 * A09 / A.8.15 / R (STRIDE): bitácora de seguridad append-only.
 * - Escritura solo desde microservicios con JWT de servicio; cada evento solo lo puede emitir
 *   el servicio dueño de ese evento.
 * - El usuario de BD de este servicio solo tiene INSERT y SELECT, y hay triggers que impiden
 *   UPDATE/DELETE aunque alguien tenga más permisos.
 * - Cada fila guarda el hash SHA-256 de la anterior (cadena de hashes): si alguien altera
 *   o borra una fila directamente en la BD, /integridad lo detecta.
 */
final class AuditController
{
    /** Evento → servicios que pueden emitirlo. */
    private const EVENTOS = [
        'LOGIN_CLIENTE_EXITOSO'   => ['auth-service'],
        'LOGIN_CLIENTE_FALLIDO'   => ['auth-service'],
        'REGISTRO_CLIENTE'        => ['auth-service'],
        'ACCESO_ADMIN_PANEL'      => ['auth-service'],
        'TOKEN_REVOCADO'          => ['auth-service'],
        'EXPORTACION_CLIENTES'    => ['auth-service'],
        'PEDIDO_CREADO'           => ['pedidos-service'],
        'PEDIDO_ESTADO_CAMBIADO'  => ['pedidos-service'],
        'PAGO_INICIADO'           => ['pagos-service'],
        'PAGO_CONFIRMADO'         => ['pagos-service'],
        'PAGO_FALLIDO'            => ['pagos-service'],
        'WEBHOOK_STRIPE_RECIBIDO' => ['pagos-service'],
        'PRECIO_MODIFICADO'       => ['catalogo-service'],
        'PRODUCTO_AGOTADO'        => ['catalogo-service', 'pedidos-service'],
        'EMAIL_ENVIADO'           => ['notificaciones-service'],
    ];
    private const SERVICIOS = ['auth-service', 'catalogo-service', 'pedidos-service', 'pagos-service', 'notificaciones-service'];
    private const ROLES = ['admin', 'cliente', 'anonimo'];
    private const RESULTADOS = ['EXITO', 'FALLO', 'FRAUDE'];
    private const COLUMNAS = ['timestamp', 'usuario_id', 'usuario_email', 'rol', 'accion', 'servicio', 'pedido_id',
                              'pago_id', 'dato_anterior', 'dato_nuevo', 'ip_origen', 'user_agent', 'resultado'];

    public function registrar(): array
    {
        $servicio = Guard::servicio(self::SERVICIOS);
        $e = Http::body();

        $accion = $e['accion'] ?? null;
        if (!is_string($accion) || !isset(self::EVENTOS[$accion])) {
            throw new ApiError(422, 'Código de evento desconocido');
        }
        if (!in_array($servicio, self::EVENTOS[$accion], true)) {
            throw new ApiError(403, "El servicio $servicio no puede emitir $accion");
        }
        $resultado = in_array($e['resultado'] ?? null, self::RESULTADOS, true) ? $e['resultado'] : throw new ApiError(422, 'Resultado inválido');
        $rol = in_array($e['rol'] ?? 'anonimo', self::ROLES, true) ? ($e['rol'] ?? 'anonimo') : 'anonimo';

        $fila = [
            // La hora la pone el servicio de auditoría, no quien reporta.
            'timestamp'     => (new \DateTimeImmutable())->format('Y-m-d H:i:s.v'),
            'usuario_id'    => isset($e['usuario_id']) && is_numeric($e['usuario_id']) ? (string) (int) $e['usuario_id'] : null,
            'usuario_email' => isset($e['usuario_email']) ? mb_substr((string) $e['usuario_email'], 0, 120) : null,
            'rol'           => $rol,
            'accion'        => $accion,
            'servicio'      => $servicio,  // sale del token, no del cuerpo
            'pedido_id'     => $this->uuid($e['pedido_id'] ?? null),
            'pago_id'       => $this->uuid($e['pago_id'] ?? null),
            'dato_anterior' => isset($e['dato_anterior']) ? json_encode($e['dato_anterior'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
            'dato_nuevo'    => isset($e['dato_nuevo']) ? json_encode($e['dato_nuevo'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
            'ip_origen'     => filter_var($e['ip_origen'] ?? '', FILTER_VALIDATE_IP) ?: null,
            'user_agent'    => isset($e['user_agent']) ? mb_substr((string) $e['user_agent'], 0, 255) : null,
            'resultado'     => $resultado,
        ];

        $db = Db::escritura();
        // Candado con nombre para que la cadena de hashes no se cruce entre inserciones simultáneas.
        if ((int) $db->query("SELECT GET_LOCK('audit_cadena', 5)")->fetchColumn() !== 1) {
            throw new ApiError(503, 'Bitácora ocupada, reintenta');
        }
        try {
            $previo = $db->query('SELECT hash FROM security_audit_logs ORDER BY id DESC LIMIT 1')->fetchColumn() ?: str_repeat('0', 64);
            $fila['hash_anterior'] = $previo;
            $fila['hash'] = self::huella($fila, $previo);

            $columnas = array_keys($fila);
            $db->prepare(sprintf('INSERT INTO security_audit_logs (`%s`) VALUES (%s)',
                implode('`, `', $columnas), implode(', ', array_fill(0, count($columnas), '?'))))
                ->execute(array_values($fila));
            $id = (int) $db->lastInsertId();
        } finally {
            $db->query("SELECT RELEASE_LOCK('audit_cadena')");
        }

        return [201, ['id' => $id, 'hash' => $fila['hash']]];
    }

    public function listar(): array
    {
        Guard::usuario(['admin']);
        $where = [];
        $params = [];
        foreach (['accion', 'resultado', 'servicio', 'usuario_email'] as $campo) {
            if (isset($_GET[$campo]) && is_string($_GET[$campo]) && $_GET[$campo] !== '') {
                $where[] = "$campo = ?";
                $params[] = $_GET[$campo];
            }
        }
        foreach (['desde' => '>=', 'hasta' => '<='] as $campo => $op) {
            if (isset($_GET[$campo]) && is_string($_GET[$campo]) && strtotime($_GET[$campo]) !== false) {
                $where[] = "timestamp $op ?";
                $params[] = date('Y-m-d H:i:s', strtotime($_GET[$campo]));
            }
        }
        $limite = min(500, max(1, (int) ($_GET['limite'] ?? 100)));
        $pagina = max(1, (int) ($_GET['pagina'] ?? 1));
        $condicion = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $db = Db::lectura();
        $total = $db->prepare("SELECT COUNT(*) FROM security_audit_logs $condicion");
        $total->execute($params);

        $consulta = $db->prepare("SELECT * FROM security_audit_logs $condicion ORDER BY id DESC LIMIT ? OFFSET ?");
        $consulta->execute([...$params, $limite, ($pagina - 1) * $limite]);
        $eventos = array_map(static function (array $f): array {
            $f['dato_anterior'] = $f['dato_anterior'] !== null ? json_decode($f['dato_anterior'], true) : null;
            $f['dato_nuevo'] = $f['dato_nuevo'] !== null ? json_decode($f['dato_nuevo'], true) : null;
            return $f;
        }, $consulta->fetchAll());

        return [200, ['total' => (int) $total->fetchColumn(), 'pagina' => $pagina, 'limite' => $limite, 'eventos' => $eventos]];
    }

    public function resumen(): array
    {
        Guard::usuario(['admin']);
        $filas = Db::lectura()->query('SELECT accion, resultado, COUNT(*) AS total FROM security_audit_logs
                                        GROUP BY accion, resultado ORDER BY accion, resultado')->fetchAll();
        $tipos = count(array_unique(array_column($filas, 'accion')));
        return [200, ['total' => array_sum(array_column($filas, 'total')), 'tipos_de_evento' => $tipos, 'por_evento' => $filas]];
    }

    /** Recorre la bitácora y recalcula la cadena de hashes. */
    public function integridad(): array
    {
        Guard::usuario(['admin']);
        $consulta = Db::lectura()->query('SELECT * FROM security_audit_logs ORDER BY id');
        $previo = str_repeat('0', 64);
        $revisados = 0;
        while ($fila = $consulta->fetch()) {
            $revisados++;
            if ($fila['hash_anterior'] !== $previo || !hash_equals($fila['hash'], self::huella($fila, $previo))) {
                return [200, ['integra' => false, 'revisados' => $revisados, 'primer_registro_alterado' => (int) $fila['id']]];
            }
            $previo = $fila['hash'];
        }
        return [200, ['integra' => true, 'revisados' => $revisados]];
    }

    private static function huella(array $fila, string $previo): string
    {
        $valores = [];
        foreach (self::COLUMNAS as $c) {
            $valores[] = $fila[$c] === null ? null : (string) $fila[$c];
        }
        $valores[] = $previo;
        return hash('sha256', json_encode($valores, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    private function uuid(mixed $valor): ?string
    {
        return is_string($valor) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $valor)
            ? strtolower($valor) : null;
    }
}
