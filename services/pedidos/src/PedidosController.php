<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Auditoria;
use Huellitas\Db;
use Huellitas\Env;
use Huellitas\Guard;
use Huellitas\Http;
use Huellitas\Interno;
use Huellitas\Jwt;
use Huellitas\Validar;

final class PedidosController
{
    /** Sedes donde se puede retirar (las mismas del sitio). */
    public const SEDES = [
        'Clínica veterinaria y peluquería · Av. Principal 954, Centro',
        'Guardería y hospedaje – Norte · Calle Los Robles 864, Zona Norte',
        'Paseadores y cuidadores – Sur · Blvd. Ribereño 180, Zona Sur',
    ];

    /** Transiciones que puede hacer un administrador. pendiente_pago → pagado lo hace pagos-service. */
    private const TRANSICIONES = [
        'pendiente_pago' => ['cancelado'],
        'pagado'         => ['preparando', 'cancelado'],
        'preparando'     => ['enviado', 'entregado', 'cancelado'],
        'enviado'        => ['entregado'],
        'entregado'      => [],
        'cancelado'      => [],
    ];

    public function cupon(string $codigo): array
    {
        $cupon = $this->buscarCupon($codigo) ?? throw new ApiError(404, 'Cupón no válido');
        return [200, ['cupon' => $cupon]];
    }

    /** Totales autoritativos para mostrar en el carrito antes de comprar. */
    public function cotizar(): array
    {
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $metodo = ($datos['metodo_entrega'] ?? 'domicilio') === 'retiro' ? 'retiro' : 'domicilio';
        $cupon = $this->cuponDe($datos);
        $lineas = $this->cotizarEnCatalogo($datos['items'] ?? null);

        return [200, [
            'lineas'  => array_map(fn($l) => self::lineaJson($l), $lineas),
            'cupon'   => $cupon,
            'totales' => Totales::aJson(Totales::calcular($lineas, $cupon, $metodo)),
        ]];
    }

    public function crear(): array
    {
        $claims = Guard::usuario(['cliente', 'admin']);
        $datos = Http::body();
        Validar::sinAtaques($datos);

        $nombre = Validar::texto($datos, 'nombre', 2, 100);
        $telefono = self::telefono($datos['telefono'] ?? null);
        $metodo = $datos['metodo_entrega'] ?? null;
        if (!in_array($metodo, ['domicilio', 'retiro'], true)) {
            throw new ApiError(422, 'Elige envío a domicilio o retiro en sede', ['campo' => 'metodo_entrega']);
        }
        $sede = null;
        $direccion = null;
        if ($metodo === 'retiro') {
            $sede = in_array($datos['sede'] ?? null, self::SEDES, true) ? $datos['sede'] : throw new ApiError(422, 'Sede no válida', ['campo' => 'sede']);
        } else {
            $direccion = [
                'direccion' => Validar::texto($datos, 'direccion', 5, 200),
                'ciudad'    => Validar::texto($datos, 'ciudad', 2, 80),
                'notas'     => isset($datos['notas']) && $datos['notas'] !== '' ? Validar::texto($datos, 'notas', 1, 200) : null,
            ];
        }
        $cupon = $this->cuponDe($datos);

        // 1. Precios y disponibilidad desde catalogo-service (nunca los del navegador).
        $lineas = $this->cotizarEnCatalogo($datos['items'] ?? null);
        $agotadas = array_filter($lineas, fn($l) => !$l['disponible']);
        if ($agotadas) {
            $l = reset($agotadas);
            throw new ApiError(409, "No hay suficiente stock de {$l['nombre']} ({$l['etiqueta']})", ['variante_id' => $l['variante_id']]);
        }
        $totales = Totales::calcular($lineas, $cupon, $metodo);

        // 2. Se aparta el stock (atómico e idempotente en el catálogo).
        $pedidoId = Jwt::uuid();
        $items = array_map(fn($l) => ['variante_id' => $l['variante_id'], 'cantidad' => $l['cantidad']], $lineas);
        Interno::exigir($this->catalogo('/internal/catalogo/reservar'),
            ['pedido_id' => $pedidoId, 'items' => $items, 'actor' => Auditoria::actor($claims)], 'catálogo');

        // 3. Se guarda el pedido; si algo falla, se devuelve el stock.
        $idCliente = (int) $claims['sub'];
        $db = Db::escritura();
        $db->beginTransaction();
        try {
            $db->prepare('INSERT INTO clientes (id_cliente, nombre, email, telefono) VALUES (?, ?, ?, ?)
                          ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), email = VALUES(email), telefono = VALUES(telefono)')
                ->execute([$idCliente, $nombre, $claims['email'], $telefono]);

            $direccionId = null;
            if ($direccion) {
                $db->prepare('INSERT INTO direcciones_entrega (id_cliente, direccion, ciudad, notas) VALUES (?, ?, ?, ?)
                              ON DUPLICATE KEY UPDATE notas = VALUES(notas), id = LAST_INSERT_ID(id)')
                    ->execute([$idCliente, $direccion['direccion'], $direccion['ciudad'], $direccion['notas']]);
                $direccionId = (int) $db->lastInsertId();
            }

            $db->prepare('INSERT INTO pedidos (id, id_cliente, metodo_entrega, sede, direccion_id, subtotal, descuento, envio, total, cupon)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$pedidoId, $idCliente, $metodo, $sede, $direccionId,
                    Totales::decimal($totales['subtotal']), Totales::decimal($totales['descuento']),
                    Totales::decimal($totales['envio']), Totales::decimal($totales['total']), $cupon['codigo'] ?? null]);

            $detalle = $db->prepare('INSERT INTO detalle_pedidos (pedido_id, producto_id, variante_id, producto_nombre, variante_etiqueta,
                                     imagen_url, precio_unitario, cantidad, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
            foreach ($lineas as $l) {
                $detalle->execute([$pedidoId, $l['producto_id'], $l['variante_id'], $l['nombre'], $l['etiqueta'], $l['imagen'],
                    $l['precio'], $l['cantidad'], Totales::decimal(Totales::centavos($l['precio']) * $l['cantidad'])]);
            }
            $db->prepare('INSERT INTO historial_estados (pedido_id, estado_anterior, estado_nuevo, cambiado_por, comentario) VALUES (?, NULL, ?, ?, ?)')
                ->execute([$pedidoId, 'pendiente_pago', $idCliente, 'Pedido creado por el cliente']);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            Interno::post($this->catalogo('/internal/catalogo/liberar'), ['pedido_id' => $pedidoId]);
            throw $e;
        }

        Auditoria::registrar('PEDIDO_CREADO', 'EXITO', Auditoria::actor($claims) + [
            'pedido_id'  => $pedidoId,
            'dato_nuevo' => [
                'estado'   => 'pendiente_pago',
                'total'    => Totales::decimal($totales['total']),
                'cupon'    => $cupon['codigo'] ?? null,
                'entrega'  => $metodo,
                'items'    => array_map(fn($l) => ['variante_id' => $l['variante_id'], 'cantidad' => $l['cantidad'], 'precio' => $l['precio']], $lineas),
            ],
        ]);

        return [201, ['pedido' => $this->detalle($pedidoId)]];
    }

    /** A01: el filtro por id_cliente sale del JWT, nunca de un parámetro. */
    public function misPedidos(): array
    {
        $claims = Guard::usuario();
        $consulta = Db::lectura()->prepare(self::SQL_RESUMEN . ' WHERE p.id_cliente = ? GROUP BY p.id ORDER BY p.fecha DESC LIMIT 100');
        $consulta->execute([(int) $claims['sub']]);
        return [200, ['pedidos' => array_map([self::class, 'resumenJson'], $consulta->fetchAll())]];
    }

    public function ver(string $id): array
    {
        $claims = Guard::usuario();
        $id = self::uuid($id);
        $consulta = Db::escritura()->prepare('SELECT id_cliente FROM pedidos WHERE id = ?');
        $consulta->execute([$id]);
        $dueno = $consulta->fetchColumn();

        if ($dueno === false) {
            throw new ApiError(404, 'Pedido no encontrado');
        }
        if ($claims['rol'] !== 'admin' && (int) $dueno !== (int) $claims['sub']) {
            // A01: mismo 404 que si no existiera (no se confirma que el pedido existe), pero queda registrado.
            Auditoria::registrar('ACCESO_DENEGADO', 'FALLO', Auditoria::actor($claims) + [
                'pedido_id'  => $id,
                'dato_nuevo' => ['recurso' => 'pedido', 'motivo' => 'el pedido pertenece a otro cliente'],
            ]);
            throw new ApiError(404, 'Pedido no encontrado');
        }
        return [200, ['pedido' => $this->detalle($id)]];
    }

    public function listarTodos(): array
    {
        Guard::usuario(['admin']);
        $where = '';
        $params = [];
        if (isset($_GET['estado']) && isset(self::TRANSICIONES[$_GET['estado']])) {
            $where = ' WHERE p.estado = ?';
            $params[] = $_GET['estado'];
        }
        $limite = min(200, max(1, (int) ($_GET['limite'] ?? 50)));
        $pagina = max(1, (int) ($_GET['pagina'] ?? 1));
        $consulta = Db::lectura()->prepare(self::SQL_RESUMEN . $where . ' GROUP BY p.id ORDER BY p.fecha DESC LIMIT ? OFFSET ?');
        $consulta->execute([...$params, $limite, ($pagina - 1) * $limite]);
        return [200, ['pedidos' => array_map([self::class, 'resumenJson'], $consulta->fetchAll()), 'pagina' => $pagina]];
    }

    public function cambiarEstado(string $id): array
    {
        $claims = Guard::usuario(['admin']);
        $id = self::uuid($id);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $nuevo = $datos['estado'] ?? null;
        if (!is_string($nuevo) || !isset(self::TRANSICIONES[$nuevo])) {
            throw new ApiError(422, 'Estado no válido', ['campo' => 'estado']);
        }
        $comentario = isset($datos['comentario']) && $datos['comentario'] !== '' ? Validar::texto($datos, 'comentario', 1, 200) : null;

        $db = Db::escritura();
        $db->beginTransaction();
        try {
            $consulta = $db->prepare('SELECT estado, metodo_entrega, id_cliente, total FROM pedidos WHERE id = ? FOR UPDATE');
            $consulta->execute([$id]);
            $pedido = $consulta->fetch() ?: throw new ApiError(404, 'Pedido no encontrado');
            $anterior = $pedido['estado'];

            $permitidos = self::TRANSICIONES[$anterior];
            // Un pedido para retirar no pasa por "enviado"; uno a domicilio no se entrega sin enviarse.
            $permitidos = array_values(array_filter($permitidos, fn($e) =>
                !($e === 'enviado' && $pedido['metodo_entrega'] === 'retiro')
                && !($e === 'entregado' && $anterior === 'preparando' && $pedido['metodo_entrega'] === 'domicilio')));
            if (!in_array($nuevo, $permitidos, true)) {
                throw new ApiError(409, "No se puede pasar de $anterior a $nuevo", ['permitidos' => $permitidos]);
            }

            $db->prepare('UPDATE pedidos SET estado = ? WHERE id = ?')->execute([$nuevo, $id]);
            $db->prepare('INSERT INTO historial_estados (pedido_id, estado_anterior, estado_nuevo, cambiado_por, comentario) VALUES (?, ?, ?, ?, ?)')
                ->execute([$id, $anterior, $nuevo, (int) $claims['sub'], $comentario]);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }

        if ($nuevo === 'cancelado') {
            [$codigo] = Interno::post($this->catalogo('/internal/catalogo/liberar'), ['pedido_id' => $id]);
            if ($codigo !== 200) {
                error_log("No se pudo liberar el stock del pedido $id (catálogo respondió $codigo)");
            }
        }

        Auditoria::registrar('PEDIDO_ESTADO_CAMBIADO', 'EXITO', Auditoria::actor($claims) + [
            'pedido_id'     => $id,
            'dato_anterior' => ['estado' => $anterior],
            'dato_nuevo'    => ['estado' => $nuevo, 'comentario' => $comentario, 'id_cliente' => (int) $pedido['id_cliente']],
        ]);
        return [200, ['pedido' => $this->detalle($id)]];
    }

    // ---------- Apoyo ----------

    private const SQL_RESUMEN = 'SELECT p.id, p.estado, p.metodo_entrega, p.total, p.fecha, p.id_cliente, c.nombre AS cliente,
                                        SUM(d.cantidad) AS unidades, MIN(d.imagen_url) AS imagen
                                   FROM pedidos p
                                   JOIN clientes c ON c.id_cliente = p.id_cliente
                                   JOIN detalle_pedidos d ON d.pedido_id = p.id';

    private function detalle(string $id): array
    {
        $db = Db::escritura();
        $consulta = $db->prepare('SELECT p.*, c.nombre, c.email, c.telefono, d.direccion, d.ciudad, d.notas
                                    FROM pedidos p
                                    JOIN clientes c ON c.id_cliente = p.id_cliente
                               LEFT JOIN direcciones_entrega d ON d.id = p.direccion_id
                                   WHERE p.id = ?');
        $consulta->execute([$id]);
        $p = $consulta->fetch() ?: throw new ApiError(404, 'Pedido no encontrado');

        $items = $db->prepare('SELECT producto_id, variante_id, producto_nombre, variante_etiqueta, imagen_url, precio_unitario, cantidad, subtotal
                                 FROM detalle_pedidos WHERE pedido_id = ? ORDER BY id');
        $items->execute([$id]);
        $historial = $db->prepare('SELECT estado_anterior, estado_nuevo, comentario, fecha FROM historial_estados WHERE pedido_id = ? ORDER BY id');
        $historial->execute([$id]);

        return [
            'id'             => $p['id'],
            'estado'         => $p['estado'],
            'fecha'          => $p['fecha'],
            'metodo_entrega' => $p['metodo_entrega'],
            'sede'           => $p['sede'],
            'direccion'      => $p['direccion'] ? ['direccion' => $p['direccion'], 'ciudad' => $p['ciudad'], 'notas' => $p['notas']] : null,
            'contacto'       => ['nombre' => $p['nombre'], 'email' => $p['email'], 'telefono' => $p['telefono']],
            'cupon'          => $p['cupon'],
            'subtotal'       => (float) $p['subtotal'],
            'descuento'      => (float) $p['descuento'],
            'envio'          => (float) $p['envio'],
            'total'          => (float) $p['total'],
            'items'          => array_map(fn($i) => [
                'producto_id'     => (int) $i['producto_id'],
                'variante_id'     => (int) $i['variante_id'],
                'nombre'          => $i['producto_nombre'],
                'etiqueta'        => $i['variante_etiqueta'],
                'imagen'          => $i['imagen_url'],
                'precio_unitario' => (float) $i['precio_unitario'],
                'cantidad'        => (int) $i['cantidad'],
                'subtotal'        => (float) $i['subtotal'],
            ], $items->fetchAll()),
            'historial'      => $historial->fetchAll(),
        ];
    }

    private static function resumenJson(array $p): array
    {
        return [
            'id' => $p['id'], 'estado' => $p['estado'], 'metodo_entrega' => $p['metodo_entrega'], 'total' => (float) $p['total'],
            'fecha' => $p['fecha'], 'cliente' => $p['cliente'], 'id_cliente' => (int) $p['id_cliente'],
            'unidades' => (int) $p['unidades'], 'imagen' => $p['imagen'],
        ];
    }

    private static function lineaJson(array $l): array
    {
        return [
            'variante_id' => $l['variante_id'], 'producto_id' => $l['producto_id'], 'nombre' => $l['nombre'],
            'etiqueta' => $l['etiqueta'], 'imagen' => $l['imagen'], 'precio' => (float) $l['precio'],
            'cantidad' => $l['cantidad'], 'disponible' => $l['disponible'],
        ];
    }

    private function cotizarEnCatalogo(mixed $items): array
    {
        if (!is_array($items)) {
            throw new ApiError(422, 'El carrito está vacío');
        }
        // Solo se reenvía id y cantidad: cualquier "precio" que mande el navegador se descarta aquí.
        $limpios = array_map(fn($i) => ['variante_id' => $i['variante_id'] ?? null, 'cantidad' => $i['cantidad'] ?? null],
            array_filter($items, 'is_array'));
        return Interno::exigir($this->catalogo('/internal/catalogo/cotizar'), ['items' => array_values($limpios)], 'catálogo')['lineas'];
    }

    private function cuponDe(array $datos): ?array
    {
        $codigo = $datos['cupon'] ?? null;
        if ($codigo === null || $codigo === '') {
            return null;
        }
        if (!is_string($codigo)) {
            throw new ApiError(422, 'Cupón no válido', ['campo' => 'cupon']);
        }
        return $this->buscarCupon($codigo) ?? throw new ApiError(422, 'Cupón no válido', ['campo' => 'cupon']);
    }

    private function buscarCupon(string $codigo): ?array
    {
        $codigo = strtoupper(trim($codigo));
        if (!preg_match('/^[A-Z0-9]{3,30}$/', $codigo)) {
            return null;
        }
        $consulta = Db::lectura()->prepare('SELECT codigo, descripcion, porcentaje, marca FROM cupones
                                             WHERE codigo = ? AND activo = 1 AND (vence IS NULL OR vence > NOW())');
        $consulta->execute([$codigo]);
        $cupon = $consulta->fetch();
        return $cupon ? ['codigo' => $cupon['codigo'], 'descripcion' => $cupon['descripcion'],
                         'porcentaje' => (int) $cupon['porcentaje'], 'marca' => $cupon['marca']] : null;
    }

    private function catalogo(string $ruta): string
    {
        return rtrim(Env::get('CATALOGO_URL', 'http://catalogo-service:8082'), '/') . $ruta;
    }

    private static function telefono(mixed $valor): string
    {
        $valor = is_string($valor) ? trim($valor) : '';
        if (!preg_match('/^\+?[0-9 ()\-]{7,20}$/', $valor) || strlen(preg_replace('/\D/', '', $valor)) < 7) {
            throw new ApiError(422, 'Teléfono no válido', ['campo' => 'telefono']);
        }
        return $valor;
    }

    private static function uuid(string $valor): string
    {
        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $valor)) {
            throw new ApiError(404, 'Pedido no encontrado');
        }
        return $valor;
    }
}
