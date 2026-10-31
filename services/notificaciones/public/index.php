<?php
declare(strict_types=1);

const SERVICE_DIR = __DIR__ . '/..';
require '/var/www/shared/bootstrap.php';

use App\ClimaController;
use App\GoogleController;
use App\NotificacionesController;
use Huellitas\Router;

$router = new Router();
$notificaciones = new NotificacionesController();

$router->add('GET',  '/salud', fn() => [200, ['estado' => 'ok', 'servicio' => 'notificaciones-service']]);
// Solo pedidos-service: el correo de confirmación sale cuando el pago ya está confirmado.
$router->add('POST', '/internal/notificaciones/pedido-pagado', fn() => $notificaciones->pedidoPagado());
// Solo citas-service: reserva, confirmación o cancelación de una cita.
$router->add('POST', '/internal/notificaciones/pedido-estado', fn() => $notificaciones->pedidoEstado());
$router->add('POST', '/internal/notificaciones/cita', fn() => $notificaciones->cita());
$router->add('POST', '/internal/notificaciones/vacuna', fn() => $notificaciones->vacuna());
$router->add('POST', '/internal/notificaciones/verificar', fn() => $notificaciones->verificar());
// Solo pedidos-service: el panel admin pide el clima a través de /api/pedidos/admin/clima.
$router->add('POST', '/internal/notificaciones/clima', fn() => (new ClimaController())->actual());
// Solo auth-service: certificados públicos para verificar el inicio de sesión con Google.
$router->add('POST', '/internal/notificaciones/google-certificados', fn() => (new GoogleController())->certificados());

$router->dispatch();
