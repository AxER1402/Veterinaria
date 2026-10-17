<?php
declare(strict_types=1);

// Recordatorios de citas y vacunas, y cierre de citas sin atender (ver App\Recordatorios).
// Fuera de public/: no se puede ejecutar por HTTP.
const SERVICE_DIR = __DIR__ . '/..';
require '/var/www/shared/bootstrap.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
// Para la bitácora: estos eventos no vienen de un navegador.
$_SERVER['HTTP_USER_AGENT'] = 'huellitas-recordatorios';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';

$r = (new App\Recordatorios())->ejecutar();
echo json_encode(['fecha' => date('c')] + $r, JSON_UNESCAPED_SLASHES), PHP_EOL;
