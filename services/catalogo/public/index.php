<?php
declare(strict_types=1);

const SERVICE_DIR = __DIR__ . '/..';
require '/var/www/shared/bootstrap.php';

use App\CatalogoController;
use App\StockController;
use Huellitas\Router;

$router = new Router();
$catalogo = new CatalogoController();
$stock = new StockController();

$router->add('GET',   '/salud', fn() => [200, ['estado' => 'ok', 'servicio' => 'catalogo-service']]);

// Público: el catálogo se ve sin registrarse.
$router->add('GET',   '/api/catalogo/productos', fn() => $catalogo->listar());
$router->add('GET',   '/api/catalogo/productos/{slug}', fn($p) => $catalogo->ver($p['slug']));

// Administración.
$router->add('GET',   '/api/catalogo/admin/productos', fn() => $catalogo->listarAdmin());
$router->add('POST',  '/api/catalogo/admin/productos', fn() => $catalogo->crearProducto());
$router->add('PATCH', '/api/catalogo/admin/productos/{id}', fn($p) => $catalogo->actualizarProducto((int) $p['id']));
$router->add('POST',  '/api/catalogo/admin/productos/{id}/variantes', fn($p) => $catalogo->agregarVariantes((int) $p['id']));
$router->add('PATCH', '/api/catalogo/admin/variantes/{id}', fn($p) => $catalogo->actualizarVariante((int) $p['id']));
$router->add('POST',  '/api/catalogo/admin/imagenes/firma', fn() => $catalogo->firmaCloudinary());

// Solo pedidos-service (JWT de servicio).
$router->add('POST',  '/internal/catalogo/cotizar', fn() => $stock->cotizar());
$router->add('POST',  '/internal/catalogo/reservar', fn() => $stock->reservar());
$router->add('POST',  '/internal/catalogo/liberar', fn() => $stock->liberar());

$router->dispatch();
