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

    public static function lectura(): PDO
    {
        $replica = Env::get('DB_READ_HOST');
        if ($replica === null) {
            return self::escritura();
        }
        try {
            return self::$lectura ??= self::conectar($replica);
        } catch (\PDOException $e) {
            // Si la réplica cae, se lee del maestro (continuidad del servicio).
            error_log('Réplica no disponible, se usa el maestro: ' . $e->getMessage());
            return self::escritura();
        }
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
