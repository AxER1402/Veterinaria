<?php
declare(strict_types=1);

namespace Huellitas;

final class Router
{
    /** @var list<array{string, string, callable}> */
    private array $rutas = [];

    public function add(string $metodo, string $patron, callable $accion): void
    {
        // {id} → grupo con nombre; solo letras, números y guiones (UUIDs, enteros).
        $regex = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>[A-Za-z0-9\-]+)', $patron) . '$#';
        $this->rutas[] = [$metodo, $regex, $accion];
    }

    public function dispatch(): never
    {
        $metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $ruta = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

        try {
            $permitidos = [];
            foreach ($this->rutas as [$m, $regex, $accion]) {
                if (!preg_match($regex, $ruta, $coincide)) {
                    continue;
                }
                if ($m !== $metodo) {
                    $permitidos[] = $m;
                    continue;
                }
                $params = array_filter($coincide, 'is_string', ARRAY_FILTER_USE_KEY);
                $respuesta = $accion($params);
                Http::json($respuesta[0], $respuesta[1]);
            }
            if ($permitidos) {
                header('Allow: ' . implode(', ', array_unique($permitidos)));
                throw new ApiError(405, 'Método no permitido');
            }
            throw new ApiError(404, 'Recurso no encontrado');
        } catch (ApiError $e) {
            Http::json($e->status, ['error' => $e->getMessage()] + $e->extra);
        } catch (\Throwable $e) {
            // A05/A09: el detalle va al log, al cliente solo un mensaje genérico.
            error_log(sprintf('[%s] %s en %s:%d', $e::class, $e->getMessage(), $e->getFile(), $e->getLine()));
            Http::json(500, ['error' => 'Error interno']);
        }
    }
}
