<?php
declare(strict_types=1);

const SERVICE_DIR = __DIR__ . '/..';
require '/var/www/shared/bootstrap.php';

use App\CitasController;
use Huellitas\Router;

$router = new Router();
$citas = new CitasController();

$router->add('GET',    '/salud', fn() => [200, ['estado' => 'ok', 'servicio' => 'citas-service']]);

// Públicos: se puede ver qué turnos hay libres sin cuenta.
$router->add('GET',    '/api/citas/servicios', fn() => $citas->servicios());
$router->add('GET',    '/api/citas/disponibilidad', fn() => $citas->disponibilidad());

// Mascotas del cliente (solo las suyas).
$router->add('GET',    '/api/citas/mascotas', fn() => $citas->mascotas());
$router->add('POST',   '/api/citas/mascotas', fn() => $citas->crearMascota());
$router->add('PATCH',  '/api/citas/mascotas/{id}', fn($p) => $citas->actualizarMascota($p['id']));
$router->add('DELETE', '/api/citas/mascotas/{id}', fn($p) => $citas->desactivarMascota($p['id']));

// Administración.
$router->add('GET',    '/api/citas/admin/agenda', fn() => $citas->agenda());
$router->add('PATCH',  '/api/citas/admin/{id}/estado', fn($p) => $citas->cambiarEstado($p['id']));

// Citas del cliente.
$router->add('GET',    '/api/citas', fn() => $citas->misCitas());
$router->add('POST',   '/api/citas', fn() => $citas->crear());
$router->add('POST',   '/api/citas/{id}/cancelar', fn($p) => $citas->cancelar($p['id']));

$router->dispatch();
