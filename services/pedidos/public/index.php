<?php
declare(strict_types=1);

const SERVICE_DIR = __DIR__ . '/..';
require '/var/www/shared/bootstrap.php';

use App\PedidosController;
use Huellitas\Router;

$router = new Router();
$pedidos = new PedidosController();

$router->add('GET',   '/salud', fn() => [200, ['estado' => 'ok', 'servicio' => 'pedidos-service']]);

// Públicos: el carrito se puede cotizar sin cuenta.
$router->add('GET',   '/api/pedidos/sedes', fn() => [200, ['sedes' => PedidosController::SEDES]]);
$router->add('GET',   '/api/pedidos/cupones/{codigo}', fn($p) => $pedidos->cupon($p['codigo']));
$router->add('POST',  '/api/pedidos/cotizar', fn() => $pedidos->cotizar());

// Administración.
$router->add('GET',   '/api/pedidos/admin/todos', fn() => $pedidos->listarTodos());
$router->add('GET',   '/api/pedidos/admin/resumen', fn() => $pedidos->resumen());
$router->add('GET',   '/api/pedidos/admin/clima', fn() => $pedidos->clima());
$router->add('PATCH', '/api/pedidos/admin/{id}/estado', fn($p) => $pedidos->cambiarEstado($p['id']));

// Pago: el cliente dueño lo inicia aquí; pedidos-service habla con pagos-service por la red interna.
$router->add('POST',  '/api/pedidos/{id}/pago', fn($p) => $pedidos->iniciarPago($p['id']));
$router->add('POST',  '/api/pedidos/{id}/pago/paypal/capturar', fn($p) => $pedidos->capturarPayPal($p['id']));

// Solo pagos-service: confirma que la pasarela cobró.
$router->add('POST',  '/internal/pedidos/pagado', fn() => $pedidos->pagadoInterno());

// Cliente autenticado: solo ve y crea sus propios pedidos.
$router->add('POST',  '/api/pedidos', fn() => $pedidos->crear());
$router->add('GET',   '/api/pedidos', fn() => $pedidos->misPedidos());
$router->add('GET',   '/api/pedidos/{id}', fn($p) => $pedidos->ver($p['id']));

$router->dispatch();
