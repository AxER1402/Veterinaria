<?php
declare(strict_types=1);

// Arranque común de todos los microservicios PHP.
// A05: los errores nunca se muestran al cliente, solo van al log del contenedor.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);
date_default_timezone_set(getenv('TZ') ?: 'America/Guatemala');

spl_autoload_register(static function (string $clase): void {
    $prefijos = [
        'Huellitas\\' => __DIR__ . '/src/',
        'App\\'       => SERVICE_DIR . '/src/',
    ];
    foreach ($prefijos as $prefijo => $dir) {
        if (str_starts_with($clase, $prefijo)) {
            $archivo = $dir . str_replace('\\', '/', substr($clase, strlen($prefijo))) . '.php';
            if (is_file($archivo)) {
                require $archivo;
            }
            return;
        }
    }
});

header_remove('X-Powered-By');
