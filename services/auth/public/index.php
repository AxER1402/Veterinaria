<?php
declare(strict_types=1);

const SERVICE_DIR = __DIR__ . '/..';
require '/var/www/shared/bootstrap.php';

use App\AuthController;
use Huellitas\Router;

$router = new Router();
$auth = new AuthController();

$router->add('GET',  '/salud', fn() => [200, ['estado' => 'ok', 'servicio' => 'auth-service']]);
$router->add('POST', '/api/auth/registro', fn() => $auth->registro());
$router->add('POST', '/api/auth/login', fn() => $auth->login());
$router->add('POST', '/api/auth/logout', fn() => $auth->logout());
$router->add('GET',  '/api/auth/me', fn() => $auth->me());
$router->add('POST', '/api/auth/admin/acceso', fn() => $auth->accesoAdmin());

$router->dispatch();
