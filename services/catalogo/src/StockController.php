<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Auditoria;
use Huellitas\Db;
use Huellitas\Guard;
use Huellitas\Http;

/** Operaciones internas que usa pedidos-service. Siempre contra el maestro (dato autoritativo). */
final class StockController
{
    /**
     * T de STRIDE: el precio de cada línea sale de aquí, nunca del carrito del navegador.
     * Entrada: {items: [{variante_id, cantidad}]}
     */
    public function cotizar(): array
    {
        Guard::servicio(['pedidos-service']);
        $items = self::items(Http::body());

        $marcas = implode(',', array_fill(0, count($items), '?'));
        $consulta = Db::escritura()->prepare("SELECT v.id, v.producto_id, v.etiqueta, v.precio, v.stock,
                                                     p.nombre, p.marca, p.imagen_url, p.activo
                                                FROM producto_variantes v JOIN productos p ON p.id = v.producto_id
                                               WHERE v.id IN ($marcas)");
        $consulta->execute(array_keys($items));
        $filas = array_column($consulta->fetchAll(), null, 'id');

        $lineas = [];
        foreach ($items as $varianteId => $cantidad) {
            $v = $filas[$varianteId] ?? null;
            if ($v === null || !$v['activo']) {
                throw new ApiError(409, 'Uno de los productos del carrito ya no está disponible', ['variante_id' => $varianteId]);
            }
            $lineas[] = [
                'variante_id' => $varianteId,
                'producto_id' => (int) $v['producto_id'],
                'nombre'      => $v['nombre'],
                'marca'       => $v['marca'],
                'etiqueta'    => $v['etiqueta'],
                'imagen'      => Cloudinary::url($v['imagen_url'], 200),
                'precio'      => $v['precio'],   // texto "19.99": sin errores de coma flotante
                'cantidad'    => $cantidad,
                'disponible'  => (int) $v['stock'] >= $cantidad,
            ];
        }
        return [200, ['lineas' => $lineas]];
    }

    /**
     * Descuenta stock para un pedido de forma atómica e idempotente.
     * Entrada: {pedido_id, items: [{variante_id, cantidad}], actor: {usuario_id, usuario_email, rol}}
     */
    public function reservar(): array
    {
        Guard::servicio(['pedidos-service']);
        $datos = Http::body();
        $pedidoId = self::uuid($datos['pedido_id'] ?? null);
        $items = self::items($datos);

        $db = Db::escritura();
        $agotadas = [];
        $db->beginTransaction();
        try {
            $existe = $db->prepare('SELECT 1 FROM reservas_stock WHERE pedido_id = ? LIMIT 1');
            $existe->execute([$pedidoId]);
            if ($existe->fetchColumn()) {
                $db->rollBack();
                return [200, ['pedido_id' => $pedidoId, 'reservado' => true, 'repetido' => true]];
            }

            // Se bloquean las filas en orden de id para evitar interbloqueos entre pedidos simultáneos.
            ksort($items);
            $bloquear = $db->prepare('SELECT v.stock, v.etiqueta, v.sku, v.producto_id, p.nombre
                                        FROM producto_variantes v JOIN productos p ON p.id = v.producto_id
                                       WHERE v.id = ? FOR UPDATE');
            $descontar = $db->prepare('UPDATE producto_variantes SET stock = stock - ? WHERE id = ?');
            $reserva = $db->prepare('INSERT INTO reservas_stock (pedido_id, variante_id, cantidad) VALUES (?, ?, ?)');
            foreach ($items as $varianteId => $cantidad) {
                $bloquear->execute([$varianteId]);
                $v = $bloquear->fetch() ?: throw new ApiError(409, 'Uno de los productos del carrito ya no está disponible');
                if ((int) $v['stock'] < $cantidad) {
                    throw new ApiError(409, "No hay suficiente stock de {$v['nombre']} ({$v['etiqueta']})", ['variante_id' => $varianteId]);
                }
                $descontar->execute([$cantidad, $varianteId]);
                $reserva->execute([$pedidoId, $varianteId, $cantidad]);
                if ((int) $v['stock'] === $cantidad) {
                    $agotadas[] = ['producto_id' => (int) $v['producto_id'], 'producto' => $v['nombre'], 'variante_id' => $varianteId,
                                   'variante' => $v['etiqueta'], 'sku' => $v['sku'], 'stock_anterior' => (int) $v['stock']];
                }
            }
            $db->commit();
        } catch (\Throwable $e) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $e;
        }
        CatalogoController::invalidar();

        $actor = self::actor($datos['actor'] ?? []);
        foreach ($agotadas as $a) {
            $stockAnterior = $a['stock_anterior'];
            unset($a['stock_anterior']);
            Auditoria::registrar('PRODUCTO_AGOTADO', 'EXITO', $actor + [
                'pedido_id'     => $pedidoId,
                'dato_anterior' => $a + ['stock' => $stockAnterior],
                'dato_nuevo'    => $a + ['stock' => 0, 'origen' => 'venta'],
            ]);
        }
        return [200, ['pedido_id' => $pedidoId, 'reservado' => true]];
    }

    /** Devuelve el stock de un pedido cancelado (idempotente). Entrada: {pedido_id} */
    public function liberar(): array
    {
        Guard::servicio(['pedidos-service']);
        $pedidoId = self::uuid(Http::body()['pedido_id'] ?? null);

        $db = Db::escritura();
        $db->beginTransaction();
        try {
            $reservas = $db->prepare("SELECT variante_id, cantidad FROM reservas_stock
                                       WHERE pedido_id = ? AND estado = 'reservada' ORDER BY variante_id FOR UPDATE");
            $reservas->execute([$pedidoId]);
            $filas = $reservas->fetchAll();
            $devolver = $db->prepare('UPDATE producto_variantes SET stock = stock + ? WHERE id = ?');
            foreach ($filas as $r) {
                $devolver->execute([$r['cantidad'], $r['variante_id']]);
            }
            $db->prepare("UPDATE reservas_stock SET estado = 'liberada' WHERE pedido_id = ?")->execute([$pedidoId]);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        if ($filas) {
            CatalogoController::invalidar();
        }
        return [200, ['pedido_id' => $pedidoId, 'liberadas' => count($filas)]];
    }

    /** @return array<int, int> variante_id => cantidad (se suman duplicados) */
    private static function items(array $datos): array
    {
        $items = $datos['items'] ?? null;
        if (!is_array($items) || !$items || count($items) > 30) {
            throw new ApiError(422, 'El carrito debe tener entre 1 y 30 productos');
        }
        $resultado = [];
        foreach ($items as $item) {
            $id = $item['variante_id'] ?? null;
            $cantidad = $item['cantidad'] ?? null;
            if (!is_int($id) || $id < 1 || !is_int($cantidad) || $cantidad < 1 || $cantidad > 99) {
                throw new ApiError(422, 'Producto o cantidad inválidos en el carrito');
            }
            $resultado[$id] = ($resultado[$id] ?? 0) + $cantidad;
            if ($resultado[$id] > 99) {
                throw new ApiError(422, 'Máximo 99 unidades por producto');
            }
        }
        return $resultado;
    }

    private static function uuid(mixed $valor): string
    {
        if (!is_string($valor) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $valor)) {
            throw new ApiError(422, 'pedido_id inválido');
        }
        return $valor;
    }

    private static function actor(mixed $a): array
    {
        return [
            'usuario_id'    => is_int($a['usuario_id'] ?? null) ? $a['usuario_id'] : null,
            'usuario_email' => is_string($a['usuario_email'] ?? null) ? $a['usuario_email'] : null,
            'rol'           => in_array($a['rol'] ?? null, ['admin', 'cliente'], true) ? $a['rol'] : 'anonimo',
        ];
    }
}
