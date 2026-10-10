<?php
declare(strict_types=1);

const SERVICE_DIR = __DIR__ . '/..';
require '/var/www/shared/bootstrap.php';

use App\NotificacionesController;
use Huellitas\Router;

$router = new Router();
$notificaciones = new NotificacionesController();

$router->add('GET',  '/salud', fn() => [200, ['estado' => 'ok', 'servicio' => 'notificaciones-service']]);
// Solo pedidos-service: el correo de confirmación sale cuando el pago ya está confirmado.
$router->add('POST', '/internal/notificaciones/pedido-pagado', fn() => $notificaciones->pedidoPagado());
$router->add('POST', '/internal/notificaciones/verificar', fn() => $notificaciones->verificar());

$router->dispatch();
