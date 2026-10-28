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
$router->add('GET',    '/api/citas/calendario', fn() => $citas->calendario());

// Mascotas del cliente (solo las suyas).
$router->add('GET',    '/api/citas/mascotas', fn() => $citas->mascotas());
$router->add('POST',   '/api/citas/mascotas', fn() => $citas->crearMascota());
$router->add('PATCH',  '/api/citas/mascotas/{id}', fn($p) => $citas->actualizarMascota($p['id']));
$router->add('DELETE', '/api/citas/mascotas/{id}', fn($p) => $citas->desactivarMascota($p['id']));
$router->add('GET',    '/api/citas/mascotas/{id}/carne', fn($p) => $citas->carne($p['id']));

// Personal de la clínica (cada acción revisa el rol: agenda para clínica, historial para veterinario).
$router->add('GET',    '/api/citas/admin/agenda', fn() => $citas->agenda());
$router->add('GET',    '/api/citas/admin/semana', fn() => $citas->semana());
$router->add('GET',    '/api/citas/admin/buscar', fn() => $citas->buscar());
$router->add('GET',    '/api/citas/admin/resumen', fn() => $citas->resumen());
$router->add('POST',   '/api/citas/admin/citas', fn() => $citas->crearAdmin());
$router->add('POST',   '/api/citas/admin/confirmar-dia', fn() => $citas->confirmarDia());
$router->add('GET',    '/api/citas/admin/equipo', fn() => $citas->equipo());
$router->add('POST',   '/api/citas/admin/equipo', fn() => $citas->guardarProfesional());
$router->add('PATCH',  '/api/citas/admin/equipo/{id}', fn($p) => $citas->guardarProfesional((int) $p['id']));
$router->add('GET',    '/api/citas/admin/bloqueos', fn() => $citas->bloqueos());
$router->add('POST',   '/api/citas/admin/bloqueos', fn() => $citas->bloquear());
$router->add('DELETE', '/api/citas/admin/bloqueos/{id}', fn($p) => $citas->desbloquear($p['id']));
$router->add('GET',    '/api/citas/admin/clientes/contadores', fn() => $citas->contadoresClientes());
$router->add('GET',    '/api/citas/admin/clientes/{id}', fn($p) => $citas->cliente((int) $p['id']));
$router->add('POST',   '/api/citas/admin/clientes/{id}/mascotas', fn($p) => $citas->crearMascotaCliente((int) $p['id']));
$router->add('GET',    '/api/citas/admin/pacientes', fn() => $citas->pacientes());
$router->add('GET',    '/api/citas/admin/mascotas/{id}/historial', fn($p) => $citas->historialAdmin($p['id']));
$router->add('PATCH',  '/api/citas/admin/mascotas/{id}/alertas', fn($p) => $citas->actualizarAlertas($p['id']));
$router->add('POST',   '/api/citas/admin/mascotas/{id}/consultas', fn($p) => $citas->registrarConsultaSinCita($p['id']));
$router->add('POST',   '/api/citas/admin/mascotas/{id}/vacunas', fn($p) => $citas->registrarVacunaExterna($p['id']));
$router->add('POST',   '/api/citas/admin/historial/{id}/adendas', fn($p) => $citas->agregarAdenda($p['id']));
$router->add('POST',   '/api/citas/admin/historial/{id}/adjuntos', fn($p) => $citas->registrarAdjunto($p['id']));
$router->add('POST',   '/api/citas/admin/adjuntos/firma', fn() => $citas->firmaAdjunto());
$router->add('PATCH',  '/api/citas/admin/{id}/estado', fn($p) => $citas->cambiarEstado($p['id']));
$router->add('POST',   '/api/citas/admin/{id}/historial', fn($p) => $citas->registrarHistorial($p['id']));
$router->add('POST',   '/api/citas/admin/{id}/notas', fn($p) => $citas->registrarNota($p['id']));

// Citas del cliente (el personal también puede reprogramar y cancelar cualquiera).
$router->add('GET',    '/api/citas', fn() => $citas->misCitas());
$router->add('POST',   '/api/citas', fn() => $citas->crear());
$router->add('POST',   '/api/citas/{id}/cancelar', fn($p) => $citas->cancelar($p['id']));
$router->add('POST',   '/api/citas/{id}/reprogramar', fn($p) => $citas->reprogramar($p['id']));

$router->dispatch();
