<?php
declare(strict_types=1);

const SERVICE_DIR = __DIR__ . '/..';
require '/var/www/shared/bootstrap.php';

use App\AuditController;
use Huellitas\Router;

$router = new Router();
$audit = new AuditController();

$router->add('GET',  '/salud', fn() => [200, ['estado' => 'ok', 'servicio' => 'security-audit-service']]);
// Solo otros microservicios (con JWT de servicio) pueden escribir eventos.
$router->add('POST', '/internal/eventos', fn() => $audit->registrar());
// Solo administradores pueden leerlos. No existe ninguna ruta PUT/PATCH/DELETE: append-only.
$router->add('GET',  '/api/auditoria/eventos', fn() => $audit->listar());
$router->add('GET',  '/api/auditoria/resumen', fn() => $audit->resumen());
$router->add('GET',  '/api/auditoria/integridad', fn() => $audit->integridad());

$router->dispatch();
