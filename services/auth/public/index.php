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
$router->add('POST', '/api/auth/login/mfa', fn() => $auth->verificarMfa());
$router->add('POST', '/api/auth/logout', fn() => $auth->logout());
$router->add('POST', '/api/auth/mfa/configurar', fn() => $auth->configurarMfa());
$router->add('POST', '/api/auth/mfa/activar', fn() => $auth->activarMfa());
$router->add('POST', '/api/auth/mfa/desactivar', fn() => $auth->desactivarMfa());
$router->add('GET',  '/api/auth/me', fn() => $auth->me());
$router->add('PATCH', '/api/auth/perfil', fn() => $auth->actualizarPerfil());
$router->add('POST', '/api/auth/admin/acceso', fn() => $auth->accesoAdmin());
$router->add('GET',  '/api/auth/admin/clientes', fn() => $auth->clientes());
$router->add('GET',  '/api/auth/admin/clientes/exportar', fn() => $auth->exportarClientes());
$router->add('GET',  '/api/auth/admin/clientes/{id}', fn($p) => $auth->cliente((int) $p['id']));
$router->add('GET',  '/api/auth/admin/personal', fn() => $auth->personal());
$router->add('PATCH', '/api/auth/admin/usuarios/{id}/rol', fn($p) => $auth->cambiarRol((int) $p['id']));

$router->dispatch();
