<?php
declare(strict_types=1);

// Vence los pedidos pendientes de pago (ver PedidosController::vencerPendientes).
//   php bin/vencer.php            → usa PEDIDO_VENCE_HORAS (24 por defecto)
const SERVICE_DIR = __DIR__ . '/..';
require '/var/www/shared/bootstrap.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
// Para la bitácora: estas cancelaciones no vienen de un navegador.
$_SERVER['HTTP_USER_AGENT'] = 'huellitas-vencimientos';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';

$horas = max(1, (int) (Huellitas\Env::get('PEDIDO_VENCE_HORAS') ?? 24));
$vencidos = (new App\PedidosController())->vencerPendientes($horas);
echo json_encode(['fecha' => date('c'), 'horas' => $horas, 'vencidos' => $vencidos], JSON_UNESCAPED_SLASHES), PHP_EOL;
