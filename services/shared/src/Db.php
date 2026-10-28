<?php
declare(strict_types=1);

namespace Huellitas;

use PDO;

/**
 * A03: PDO con prepared statements reales (sin emulación) en el 100 % de las consultas.
 * A.8.3: cada servicio se conecta con su propio usuario, que solo tiene permisos sobre su BD.
 * Escrituras → maestro; lecturas pesadas (catálogo, reportes) → réplica.
 */
final class Db
{
    private static ?PDO $escritura = null;
    private static ?PDO $lectura = null;

    public static function escritura(): PDO
    {
        return self::$escritura ??= self::conectar(Env::required('DB_HOST'));
    }

    /**
     * Réplica si está al día; si no responde, si la replicación está detenida o si va más de
     * DB_MAX_RETRASO_SEG atrasada, el maestro: así nadie lee datos viejos (p. ej. un turno como libre).
     */
    public static function lectura(): PDO
    {
        if (self::$lectura !== null) {
            return self::$lectura;
        }
        $replica = Env::get('DB_READ_HOST');
        if ($replica === null) {
            return self::escritura();
        }
        try {
            $pdo = self::conectar($replica);
        } catch (\PDOException $e) {
            // Si la réplica cae, se lee del maestro (continuidad del servicio).
            error_log('Réplica no disponible, se usa el maestro: ' . $e->getMessage());
            return self::$lectura = self::escritura();
        }
        return self::$lectura = self::replicaAlDia($pdo) ? $pdo : self::escritura();
    }

    /**
     * Estado de la replicación (SHOW SLAVE STATUS, privilegio REPLICA MONITOR). Se guarda 5 s en Redis
     * para no consultarlo en cada petición. Ante cualquier duda (sin permiso, sin Redis) se usa el maestro.
     */
    private static function replicaAlDia(PDO $pdo): bool
    {
        $clave = 'db:replica:' . Env::required('DB_NAME');
        try {
            $guardado = Cache::redis()->get($clave);
            if ($guardado !== false) {
                return $guardado === '1';
            }
        } catch (\Throwable) {
            // sin caché: se consulta directo
        }
        $maximo = (int) Env::get('DB_MAX_RETRASO_SEG', '5');
        try {
            $estado = $pdo->query('SHOW SLAVE STATUS')->fetch();
            $alDia = $estado && $estado['Slave_IO_Running'] === 'Yes' && $estado['Slave_SQL_Running'] === 'Yes'
                && $estado['Seconds_Behind_Master'] !== null && (int) $estado['Seconds_Behind_Master'] <= $maximo;
            if (!$alDia) {
                error_log(sprintf('Réplica atrasada o detenida (IO=%s, SQL=%s, retraso=%s s): se usa el maestro',
                    $estado['Slave_IO_Running'] ?? '?', $estado['Slave_SQL_Running'] ?? '?', $estado['Seconds_Behind_Master'] ?? '?'));
            }
        } catch (\PDOException $e) {
            error_log('No se pudo leer el estado de la réplica, se usa el maestro: ' . $e->getMessage());
            $alDia = false;
        }
        try {
            Cache::redis()->set($clave, $alDia ? '1' : '0', ['ex' => 5]);
        } catch (\Throwable) {
        }
        return $alDia;
    }

    private static function conectar(string $host): PDO
    {
        $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            $host, Env::get('DB_PORT', '3306'), Env::required('DB_NAME'));
        return new PDO($dsn, Env::required('DB_USER'), Env::required('DB_PASSWORD'), [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_TIMEOUT            => 3,
        ]);
    }
}
