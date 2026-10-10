<?php
declare(strict_types=1);

const SERVICE_DIR = __DIR__ . '/..';
require '/var/www/shared/bootstrap.php';

use App\PagosController;
use Huellitas\Router;

$router = new Router();
$pagos = new PagosController();

$router->add('GET',  '/salud', fn() => [200, ['estado' => 'ok', 'servicio' => 'pagos-service']]);

// Solo pedidos-service (JWT de servicio): el navegador nunca llama directo a pagos.
$router->add('POST', '/internal/pagos/iniciar', fn() => $pagos->iniciar());
$router->add('POST', '/internal/pagos/paypal/capturar', fn() => $pagos->capturarPayPal());

// Única ruta pública: la llama Stripe y se autentica con la firma Stripe-Signature.
$router->add('POST', '/api/pagos/webhook/stripe', fn() => $pagos->webhookStripe());

$router->dispatch();
