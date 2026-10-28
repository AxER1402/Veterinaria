<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Auditoria;
use Huellitas\Cache;
use Huellitas\Db;
use Huellitas\Guard;
use Huellitas\Interno;
use Huellitas\Env;
use Huellitas\Http;
use Huellitas\Validar;

final class CatalogoController
{
    private const CACHE_TTL = 300;
    private const MASCOTAS = ['perro', 'gato', 'pequenos', 'peces', 'reptiles', 'aves'];
    private const MAX_VARIANTES = 10;

    /**
     * Catálogo público. D de STRIDE: se sirve desde Redis y las lecturas van a la réplica,
     * así el scraping no golpea al maestro. El gateway limita además las peticiones por IP.
     */
    public function listar(): array
    {
        $clave = 'catalogo:productos:v' . self::version();
        $cache = Cache::redis()->get($clave);
        if (is_string($cache)) {
            header('X-Cache: HIT');
            return [200, json_decode($cache, true)];
        }

        $respuesta = ['productos' => $this->consultar(Db::lectura(), soloActivos: true)];
        Cache::redis()->setex($clave, self::CACHE_TTL, json_encode($respuesta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        header('X-Cache: MISS');
        return [200, $respuesta];
    }

    public function ver(string $slug): array
    {
        [, $todo] = $this->listar();
        foreach ($todo['productos'] as $producto) {
            if ($producto['slug'] === $slug) {
                return [200, ['producto' => $producto]];
            }
        }
        throw new ApiError(404, 'Producto no encontrado');
    }

    public function listarAdmin(): array
    {
        Guard::usuario(Guard::TIENDA);
        return [200, ['productos' => $this->consultar(Db::escritura(), soloActivos: false, admin: true)]];
    }

    /**
     * Alta de un producto con sus variantes. El slug y los SKU los pone el servidor; precios y stock
     * se validan igual que al editarlos. Registra PRODUCTO_CREADO.
     */
    public function crearProducto(): array
    {
        $claims = Guard::usuario(Guard::TIENDA);
        $datos = Http::body();
        Validar::sinAtaques($datos);

        $nombre = Validar::texto($datos, 'nombre', 3, 150);
        $marca = Validar::texto($datos, 'marca', 2, 60);
        $mascota = in_array($datos['mascota'] ?? null, self::MASCOTAS, true)
            ? $datos['mascota'] : throw new ApiError(422, 'Elige para qué mascota es', ['campo' => 'mascota']);
        $descripcion = Validar::texto($datos, 'descripcion', 10, 2000);
        $etiqueta = in_array($datos['etiqueta'] ?? null, [null, ''], true) ? null : Validar::texto($datos, 'etiqueta', 2, 40);
        $imagen = self::imagen($datos['imagen_url'] ?? null);
        $opciones = [];
        foreach (['activo' => true, 'destacado' => false] as $campo => $omision) {
            $valor = $datos[$campo] ?? $omision;
            $opciones[$campo] = is_bool($valor) ? (int) $valor : throw new ApiError(422, "El campo $campo debe ser verdadero o falso", ['campo' => $campo]);
        }
        $variantes = self::variantesNuevas($datos['variantes'] ?? null);

        $db = Db::escritura();
        $categoria = $db->prepare('SELECT id FROM categorias WHERE slug = ?');
        $categoria->execute([$datos['categoria'] ?? '']);
        $categoriaId = $categoria->fetchColumn() ?: throw new ApiError(422, 'Elige una categoría', ['campo' => 'categoria']);

        $db->beginTransaction();
        try {
            $slug = self::slugLibre($db, $nombre);
            $db->prepare('INSERT INTO productos (slug, nombre, marca, mascota, categoria_id, descripcion, imagen_url, imagen_public_id,
                                                 etiqueta, destacado, activo, updated_by)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$slug, $nombre, $marca, $mascota, $categoriaId, $descripcion, $imagen,
                           Cloudinary::esPropia($imagen) && is_string($datos['imagen_public_id'] ?? null) ? mb_substr($datos['imagen_public_id'], 0, 200) : null,
                           $etiqueta, $opciones['destacado'], $opciones['activo'], (int) $claims['sub']]);
            $id = (int) $db->lastInsertId();
            // Mismo formato que el catálogo inicial: HU-<producto>-<n>.
            $insertar = $db->prepare('INSERT INTO producto_variantes (producto_id, etiqueta, sku, precio, precio_anterior, stock, updated_by)
                                      VALUES (?, ?, ?, ?, ?, ?, ?)');
            foreach ($variantes as $i => $v) {
                $insertar->execute([$id, $v['etiqueta'], sprintf('HU-%03d-%d', $id, $i + 1), $v['precio'], $v['precio_anterior'], $v['stock'], (int) $claims['sub']]);
            }
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        self::invalidar();

        $producto = $this->uno($id);
        Auditoria::registrar('PRODUCTO_CREADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['producto_id' => $id, 'producto' => $nombre, 'slug' => $slug, 'activo' => (bool) $opciones['activo'],
                             'variantes' => array_map(fn($v) => ['sku' => $v['sku'], 'etiqueta' => $v['etiqueta'], 'precio' => $v['precio'], 'stock' => $v['stock']], $producto['variantes'])],
        ]);
        return [201, ['producto' => $producto]];
    }

    /**
     * Edición del producto: datos, imagen, categoría, visible y destacado. Solo cambia lo que viene en
     * la petición y registra PRODUCTO_ACTUALIZADO con el antes y el después de cada campo.
     */
    public function actualizarProducto(int $id): array
    {
        $claims = Guard::usuario(Guard::TIENDA);
        $datos = Http::body();
        Validar::sinAtaques($datos);

        $cambios = [];
        foreach (['activo', 'destacado'] as $campo) {
            if (array_key_exists($campo, $datos)) {
                if (!is_bool($datos[$campo])) {
                    throw new ApiError(422, "El campo $campo debe ser verdadero o falso", ['campo' => $campo]);
                }
                $cambios[$campo] = $datos[$campo] ? 1 : 0;
            }
        }
        $textos = ['nombre' => [3, 150], 'marca' => [2, 60], 'descripcion' => [10, 2000]];
        foreach ($textos as $campo => [$min, $max]) {
            if (array_key_exists($campo, $datos)) {
                $cambios[$campo] = Validar::texto($datos, $campo, $min, $max);
            }
        }
        if (array_key_exists('etiqueta', $datos)) {
            $cambios['etiqueta'] = in_array($datos['etiqueta'], [null, ''], true) ? null : Validar::texto($datos, 'etiqueta', 2, 40);
        }
        if (array_key_exists('mascota', $datos)) {
            $cambios['mascota'] = in_array($datos['mascota'], self::MASCOTAS, true)
                ? $datos['mascota'] : throw new ApiError(422, 'Elige para qué mascota es', ['campo' => 'mascota']);
        }
        $db = Db::escritura();
        if (array_key_exists('categoria', $datos)) {
            $categoria = $db->prepare('SELECT id FROM categorias WHERE slug = ?');
            $categoria->execute([is_string($datos['categoria']) ? $datos['categoria'] : '']);
            $cambios['categoria_id'] = (int) ($categoria->fetchColumn() ?: throw new ApiError(422, 'Elige una categoría', ['campo' => 'categoria']));
        }
        if (array_key_exists('imagen_url', $datos)) {
            $cambios['imagen_url'] = self::imagen($datos['imagen_url']);
            $cambios['imagen_public_id'] = Cloudinary::esPropia($cambios['imagen_url']) && is_string($datos['imagen_public_id'] ?? null)
                ? mb_substr($datos['imagen_public_id'], 0, 200) : null;
        }
        if (!$cambios) {
            throw new ApiError(422, 'No hay cambios que aplicar');
        }

        $consulta = $db->prepare('SELECT ' . implode(', ', array_keys($cambios)) . ', nombre AS _nombre FROM productos WHERE id = ?');
        $consulta->execute([$id]);
        $antes = $consulta->fetch() ?: throw new ApiError(404, 'Producto no encontrado');
        $distintos = array_filter($cambios, fn($v, $c) => (string) $antes[$c] !== (string) $v, ARRAY_FILTER_USE_BOTH);
        if (!$distintos) {
            return [200, ['producto' => $this->uno($id)]];
        }
        // Las columnas salen de una lista fija; los valores van como parámetros.
        $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($distintos)));
        $db->prepare("UPDATE productos SET $set, updated_by = ? WHERE id = ?")
            ->execute([...array_values($distintos), (int) $claims['sub'], $id]);
        self::invalidar();

        // La descripción va resumida: la bitácora registra que cambió, no copia el texto entero.
        $resumen = fn(array $fila) => array_map(fn($v) => is_string($v) && mb_strlen($v) > 120 ? mb_substr($v, 0, 117) . '…' : $v,
            array_intersect_key($fila, $distintos));
        $ref = ['producto_id' => $id, 'producto' => $antes['_nombre']];
        Auditoria::registrar('PRODUCTO_ACTUALIZADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => $ref + $resumen($antes),
            'dato_nuevo'    => $ref + $resumen($distintos),
        ]);
        return [200, ['producto' => $this->uno($id)]];
    }

    /** Presentaciones nuevas para un producto que ya existe (SKU HU-<producto>-<n> siguiente). */
    public function agregarVariantes(int $id): array
    {
        $claims = Guard::usuario(Guard::TIENDA);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $nuevas = self::variantesNuevas($datos['variantes'] ?? null);

        $db = Db::escritura();
        $db->beginTransaction();
        try {
            $q = $db->prepare('SELECT nombre FROM productos WHERE id = ? FOR UPDATE');
            $q->execute([$id]);
            $nombre = $q->fetchColumn() ?: throw new ApiError(404, 'Producto no encontrado');
            $q = $db->prepare('SELECT etiqueta, sku FROM producto_variantes WHERE producto_id = ?');
            $q->execute([$id]);
            $existentes = $q->fetchAll();
            if (count($existentes) + count($nuevas) > self::MAX_VARIANTES) {
                throw new ApiError(422, 'Un producto tiene como máximo ' . self::MAX_VARIANTES . ' presentaciones', ['campo' => 'variantes']);
            }
            $etiquetas = array_map(fn($e) => mb_strtolower($e['etiqueta']), $existentes);
            $n = 0;
            foreach ($existentes as $e) {
                $n = max($n, (int) substr(strrchr($e['sku'], '-'), 1));
            }
            $insertar = $db->prepare('INSERT INTO producto_variantes (producto_id, etiqueta, sku, precio, precio_anterior, stock, updated_by)
                                      VALUES (?, ?, ?, ?, ?, ?, ?)');
            $creadas = [];
            foreach ($nuevas as $v) {
                if (in_array(mb_strtolower($v['etiqueta']), $etiquetas, true)) {
                    throw new ApiError(422, "La presentación «{$v['etiqueta']}» ya existe", ['campo' => 'variantes']);
                }
                $sku = sprintf('HU-%03d-%d', $id, ++$n);
                $insertar->execute([$id, $v['etiqueta'], $sku, $v['precio'], $v['precio_anterior'], $v['stock'], (int) $claims['sub']]);
                $creadas[] = ['sku' => $sku, 'etiqueta' => $v['etiqueta'], 'precio' => $v['precio'], 'stock' => $v['stock']];
            }
            $db->prepare('UPDATE productos SET updated_by = ? WHERE id = ?')->execute([(int) $claims['sub'], $id]);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        self::invalidar();
        Auditoria::registrar('PRODUCTO_ACTUALIZADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['producto_id' => $id, 'producto' => $nombre, 'variantes_agregadas' => $creadas],
        ]);
        return [201, ['producto' => $this->uno($id)]];
    }

    /** Cambio de precio y/o stock de una variante. Registra PRECIO_MODIFICADO y PRODUCTO_AGOTADO. */
    public function actualizarVariante(int $id): array
    {
        $claims = Guard::usuario(Guard::TIENDA);
        $datos = Http::body();

        $nuevo = [];
        if (array_key_exists('precio', $datos)) {
            $nuevo['precio'] = self::dinero($datos['precio'], 'precio');
        }
        if (array_key_exists('precio_anterior', $datos)) {
            $nuevo['precio_anterior'] = $datos['precio_anterior'] === null ? null : self::dinero($datos['precio_anterior'], 'precio_anterior');
        }
        if (array_key_exists('stock', $datos)) {
            if (!is_int($datos['stock']) || $datos['stock'] < 0 || $datos['stock'] > 100000) {
                throw new ApiError(422, 'El stock debe ser un entero entre 0 y 100000', ['campo' => 'stock']);
            }
            $nuevo['stock'] = $datos['stock'];
        }
        if (!$nuevo) {
            throw new ApiError(422, 'No hay cambios que aplicar');
        }

        $db = Db::escritura();
        $db->beginTransaction();
        try {
            $consulta = $db->prepare('SELECT v.id, v.producto_id, v.etiqueta, v.sku, v.precio, v.precio_anterior, v.stock, p.nombre
                                        FROM producto_variantes v JOIN productos p ON p.id = v.producto_id
                                       WHERE v.id = ? FOR UPDATE');
            $consulta->execute([$id]);
            $antes = $consulta->fetch() ?: throw new ApiError(404, 'Variante no encontrada');

            $final = array_merge(['precio' => $antes['precio'], 'precio_anterior' => $antes['precio_anterior']], $nuevo);
            if ($final['precio_anterior'] !== null && (float) $final['precio_anterior'] <= (float) $final['precio']) {
                throw new ApiError(422, 'El precio anterior debe ser mayor que el precio actual', ['campo' => 'precio_anterior']);
            }

            $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($nuevo)));
            $db->prepare("UPDATE producto_variantes SET $set, updated_by = ? WHERE id = ?")
                ->execute([...array_values($nuevo), (int) $claims['sub'], $id]);
            $db->prepare('UPDATE productos SET updated_by = ? WHERE id = ?')->execute([(int) $claims['sub'], $antes['producto_id']]);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        self::invalidar();

        $ref = ['producto_id' => (int) $antes['producto_id'], 'producto' => $antes['nombre'], 'variante_id' => $id, 'variante' => $antes['etiqueta'], 'sku' => $antes['sku']];
        $cambioPrecio = (isset($nuevo['precio']) && (float) $nuevo['precio'] !== (float) $antes['precio'])
            || (array_key_exists('precio_anterior', $nuevo) && $nuevo['precio_anterior'] != $antes['precio_anterior']);
        if ($cambioPrecio) {
            Auditoria::registrar('PRECIO_MODIFICADO', 'EXITO', Auditoria::actor($claims) + [
                'dato_anterior' => $ref + ['precio' => (float) $antes['precio'], 'precio_anterior' => self::num($antes['precio_anterior'])],
                'dato_nuevo'    => $ref + ['precio' => (float) $final['precio'], 'precio_anterior' => self::num($final['precio_anterior'])],
            ]);
        }
        if (isset($nuevo['stock']) && $nuevo['stock'] === 0 && (int) $antes['stock'] > 0) {
            Auditoria::registrar('PRODUCTO_AGOTADO', 'EXITO', Auditoria::actor($claims) + [
                'dato_anterior' => $ref + ['stock' => (int) $antes['stock']],
                'dato_nuevo'    => $ref + ['stock' => 0, 'origen' => 'ajuste manual'],
            ]);
        }

        return [200, ['producto' => $this->uno((int) $antes['producto_id'])]];
    }

    public function firmaCloudinary(): array
    {
        Guard::usuario(Guard::TIENDA);
        if (!Cloudinary::configurado()) {
            throw new ApiError(503, 'Cloudinary no está configurado (CLOUDINARY_* en .env)');
        }
        return [200, Cloudinary::firma()];
    }

    // ---------- Reseñas ----------

    /** Reseñas visibles de un producto (públicas), de la más nueva a la más vieja. */
    public function resenas(string $slug): array
    {
        $producto = $this->productoPorSlug($slug);
        $q = Db::escritura()->prepare('SELECT id, autor, calificacion, comentario, created_at FROM resenas
                                        WHERE producto_id = ? AND visible = 1 ORDER BY created_at DESC LIMIT 100');
        $q->execute([$producto['id']]);
        return [200, ['calificacion' => (float) $producto['calificacion'], 'total' => (int) $producto['resenas'],
                      'resenas' => array_map(fn($r) => self::resenaJson($r), $q->fetchAll())]];
    }

    /** ¿Puede opinar el cliente (compró el producto)? Y su reseña, si ya dejó una. */
    public function miResena(string $slug): array
    {
        $claims = Guard::usuario(['cliente']);
        $producto = $this->productoPorSlug($slug);
        $q = Db::escritura()->prepare('SELECT id, autor, calificacion, comentario, created_at, visible FROM resenas WHERE producto_id = ? AND id_cliente = ?');
        $q->execute([$producto['id'], (int) $claims['sub']]);
        $mia = $q->fetch();
        return [200, ['compro' => $this->compro((int) $claims['sub'], (int) $producto['id'])['compro'],
                      'resena' => $mia ? self::resenaJson($mia) + ['visible' => (bool) $mia['visible']] : null]];
    }

    /**
     * Publica o actualiza la reseña del cliente. Solo quien compró el producto (pedido pagado o más
     * avanzado): lo confirma pedidos-service por la red interna, no el navegador.
     */
    public function publicarResena(string $slug): array
    {
        $claims = Guard::usuario(['cliente']);
        $datos = Http::body();
        Validar::sinAtaques($datos);
        $producto = $this->productoPorSlug($slug);
        $calificacion = $datos['calificacion'] ?? null;
        if (!is_int($calificacion) || $calificacion < 1 || $calificacion > 5) {
            throw new ApiError(422, 'Elige de 1 a 5 estrellas', ['campo' => 'calificacion']);
        }
        $comentario = isset($datos['comentario']) && $datos['comentario'] !== '' ? Validar::texto($datos, 'comentario', 3, 600) : null;
        $compra = $this->compro((int) $claims['sub'], (int) $producto['id']);
        if (!$compra['compro']) {
            throw new ApiError(403, 'Solo puede opinar quien compró este producto');
        }
        // «Lucía Hernández» → «Lucía H.»: se publica el nombre y la inicial, no el nombre completo (A.5.34).
        $partes = preg_split('/\s+/', trim((string) ($compra['nombre'] ?? 'Cliente')));
        $autor = mb_substr($partes[0] . (isset($partes[1]) ? ' ' . mb_substr($partes[1], 0, 1) . '.' : ''), 0, 60);

        $db = Db::escritura();
        $db->prepare('INSERT INTO resenas (producto_id, id_cliente, autor, calificacion, comentario) VALUES (?, ?, ?, ?, ?)
                      ON DUPLICATE KEY UPDATE calificacion = VALUES(calificacion), comentario = VALUES(comentario), autor = VALUES(autor)')
            ->execute([$producto['id'], (int) $claims['sub'], $autor, $calificacion, $comentario]);
        $this->recalcular((int) $producto['id']);
        Auditoria::registrar('RESENA_PUBLICADA', 'EXITO', Auditoria::actor($claims) + [
            'dato_nuevo' => ['producto_id' => (int) $producto['id'], 'producto' => $producto['nombre'], 'calificacion' => $calificacion],
        ]);
        return [201, $this->resenas($slug)[1]];
    }

    /** Reseñas recientes para moderar (panel de la tienda). */
    public function resenasAdmin(): array
    {
        Guard::usuario(Guard::TIENDA);
        $q = Db::escritura()->query('SELECT r.id, r.autor, r.calificacion, r.comentario, r.created_at, r.visible, p.nombre AS producto, p.slug
                                       FROM resenas r JOIN productos p ON p.id = r.producto_id ORDER BY r.created_at DESC LIMIT 100');
        return [200, ['resenas' => array_map(fn($r) => self::resenaJson($r) + ['visible' => (bool) $r['visible'], 'producto' => $r['producto'], 'slug' => $r['slug']],
            $q->fetchAll())]];
    }

    /** Oculta o vuelve a mostrar una reseña (no se borra) y recalcula la calificación. */
    public function moderarResena(int $id): array
    {
        $claims = Guard::usuario(Guard::TIENDA);
        $datos = Http::body();
        if (!is_bool($datos['visible'] ?? null)) {
            throw new ApiError(422, 'Indica si la reseña es visible', ['campo' => 'visible']);
        }
        $db = Db::escritura();
        $q = $db->prepare('SELECT producto_id, visible FROM resenas WHERE id = ?');
        $q->execute([$id]);
        $r = $q->fetch() ?: throw new ApiError(404, 'Reseña no encontrada');
        $db->prepare('UPDATE resenas SET visible = ? WHERE id = ?')->execute([(int) $datos['visible'], $id]);
        $this->recalcular((int) $r['producto_id']);
        Auditoria::registrar('PRODUCTO_ACTUALIZADO', 'EXITO', Auditoria::actor($claims) + [
            'dato_anterior' => ['resena_id' => $id, 'visible' => (bool) $r['visible']],
            'dato_nuevo'    => ['resena_id' => $id, 'producto_id' => (int) $r['producto_id'], 'visible' => $datos['visible']],
        ]);
        return [200, ['ok' => true]];
    }

    private function recalcular(int $productoId): void
    {
        Db::escritura()->prepare('UPDATE productos p SET
                p.calificacion = COALESCE((SELECT ROUND(AVG(r.calificacion), 1) FROM resenas r WHERE r.producto_id = p.id AND r.visible = 1), 0),
                p.resenas = (SELECT COUNT(*) FROM resenas r WHERE r.producto_id = p.id AND r.visible = 1)
              WHERE p.id = ?')->execute([$productoId]);
        self::invalidar();
    }

    /** @return array{compro: bool, nombre: ?string} según pedidos-service (si no responde, no se permite). */
    private function compro(int $clienteId, int $productoId): array
    {
        [$codigo, $json] = Interno::post(rtrim(Env::get('PEDIDOS_URL', 'http://pedidos-service:8083'), '/') . '/internal/pedidos/compro',
            ['id_cliente' => $clienteId, 'producto_id' => $productoId]);
        return $codigo === 200 && is_array($json) ? ['compro' => ($json['compro'] ?? false) === true, 'nombre' => $json['nombre'] ?? null]
            : ['compro' => false, 'nombre' => null];
    }

    private function productoPorSlug(string $slug): array
    {
        $q = Db::escritura()->prepare('SELECT id, nombre, calificacion, resenas FROM productos WHERE slug = ? AND activo = 1');
        $q->execute([$slug]);
        return $q->fetch() ?: throw new ApiError(404, 'Producto no encontrado');
    }

    private static function resenaJson(array $r): array
    {
        return ['id' => (int) $r['id'], 'autor' => $r['autor'], 'calificacion' => (int) $r['calificacion'], 'comentario' => $r['comentario'],
                'fecha' => substr($r['created_at'], 0, 10)];
    }

    // ---------- Caché ----------

    public static function version(): int
    {
        return (int) (Cache::redis()->get('catalogo:version') ?: 1);
    }

    /** Cambiar la versión deja obsoletas todas las entradas de caché del catálogo. */
    public static function invalidar(): void
    {
        $r = Cache::redis();
        $r->setnx('catalogo:version', '1');
        $r->incr('catalogo:version');
    }

    // ---------- Consultas ----------

    private function uno(int $id): array
    {
        foreach ($this->consultar(Db::escritura(), soloActivos: false, admin: true, id: $id) as $p) {
            return $p;
        }
        throw new ApiError(404, 'Producto no encontrado');
    }

    private function consultar(\PDO $db, bool $soloActivos, bool $admin = false, ?int $id = null): array
    {
        $where = [];
        $params = [];
        if ($soloActivos) {
            $where[] = 'p.activo = 1';
        }
        if ($id !== null) {
            $where[] = 'p.id = ?';
            $params[] = $id;
        }
        $sql = 'SELECT p.id, p.slug, p.nombre, p.marca, p.mascota, c.slug AS categoria, p.descripcion, p.imagen_url,
                       p.calificacion, p.resenas, p.etiqueta, p.destacado, p.activo, p.updated_by, p.updated_at
                  FROM productos p JOIN categorias c ON c.id = p.categoria_id'
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY p.id';
        $consulta = $db->prepare($sql);
        $consulta->execute($params);
        $productos = [];
        foreach ($consulta->fetchAll() as $p) {
            $productos[(int) $p['id']] = [
                'id'           => (int) $p['id'],
                'slug'         => $p['slug'],
                'nombre'       => $p['nombre'],
                'marca'        => $p['marca'],
                'mascota'      => $p['mascota'],
                'categoria'    => $p['categoria'],
                'descripcion'  => $p['descripcion'],
                'imagen'       => Cloudinary::url($p['imagen_url']),
                'calificacion' => (float) $p['calificacion'],
                'resenas'      => (int) $p['resenas'],
                'etiqueta'     => $p['etiqueta'],
                'destacado'    => (bool) $p['destacado'],
                'variantes'    => [],
            ] + ($admin ? ['activo' => (bool) $p['activo'], 'imagen_url' => $p['imagen_url'], 'updated_by' => $p['updated_by'], 'updated_at' => $p['updated_at']] : []);
        }
        if (!$productos) {
            return [];
        }

        $marcas = implode(',', array_fill(0, count($productos), '?'));
        $variantes = $db->prepare("SELECT id, producto_id, etiqueta, sku, precio, precio_anterior, stock
                                     FROM producto_variantes WHERE producto_id IN ($marcas) ORDER BY id");
        $variantes->execute(array_keys($productos));
        foreach ($variantes->fetchAll() as $v) {
            $stock = (int) $v['stock'];
            $productos[(int) $v['producto_id']]['variantes'][] = [
                'id'              => (int) $v['id'],
                'etiqueta'        => $v['etiqueta'],
                'precio'          => (float) $v['precio'],
                'precio_anterior' => self::num($v['precio_anterior']),
                // Al público no se le dice el stock exacto, solo si hay y si quedan pocas.
                'disponible'      => $stock > 0,
                'pocas_unidades'  => $stock > 0 && $stock <= 5,
            ] + ($admin ? ['sku' => $v['sku'], 'stock' => $stock] : []);
        }
        return array_values($productos);
    }

    private static function dinero(mixed $valor, string $campo): string
    {
        if ((!is_int($valor) && !is_float($valor)) || $valor <= 0 || $valor > 99999.99 || round((float) $valor, 2) != $valor) {
            throw new ApiError(422, "El campo $campo debe ser un monto positivo con hasta 2 decimales", ['campo' => $campo]);
        }
        return number_format((float) $valor, 2, '.', '');
    }

    private static function num(mixed $valor): ?float
    {
        return $valor === null ? null : (float) $valor;
    }

    /**
     * Solo orígenes que la CSP del gateway deja mostrar: la cuenta de Cloudinary de la tienda o
     * una foto de Unsplash (se normaliza al tamaño del catálogo). Nada de URLs arbitrarias.
     */
    private static function imagen(mixed $url): string
    {
        $url = is_string($url) ? trim($url) : '';
        if (Cloudinary::esPropia($url)) {
            return $url;
        }
        if (preg_match('#^https://images\.unsplash\.com/(photo-[A-Za-z0-9\-]{10,80})(\?[^\s<>"\']*)?$#', $url, $m)) {
            return "https://images.unsplash.com/{$m[1]}?auto=format&fit=crop&w=600&h=600&q=75";
        }
        throw new ApiError(422, 'La imagen debe ser una foto de images.unsplash.com o estar en la cuenta de Cloudinary de la tienda', ['campo' => 'imagen_url']);
    }

    /** @return list<array{etiqueta: string, precio: string, precio_anterior: ?string, stock: int}> */
    private static function variantesNuevas(mixed $lista): array
    {
        if (!is_array($lista) || !array_is_list($lista) || count($lista) < 1 || count($lista) > self::MAX_VARIANTES) {
            throw new ApiError(422, 'Agrega entre 1 y ' . self::MAX_VARIANTES . ' presentaciones', ['campo' => 'variantes']);
        }
        $variantes = [];
        $vistas = [];
        foreach ($lista as $i => $v) {
            $n = $i + 1;
            try {
                if (!is_array($v)) {
                    throw new ApiError(422, 'datos inválidos');
                }
                $etiqueta = Validar::texto($v, 'etiqueta', 1, 40);
                $precio = self::dinero($v['precio'] ?? null, 'precio');
                $antes = ($v['precio_anterior'] ?? null) === null ? null : self::dinero($v['precio_anterior'], 'precio_anterior');
                if ($antes !== null && (float) $antes <= (float) $precio) {
                    throw new ApiError(422, 'el precio anterior debe ser mayor que el precio');
                }
                $stock = $v['stock'] ?? null;
                if (!is_int($stock) || $stock < 0 || $stock > 100000) {
                    throw new ApiError(422, 'el stock debe ser un entero entre 0 y 100000');
                }
                if (isset($vistas[mb_strtolower($etiqueta)])) {
                    throw new ApiError(422, "«{$etiqueta}» está repetida");
                }
            } catch (ApiError $e) {
                throw new ApiError(422, "Presentación $n: " . $e->getMessage(), ['campo' => 'variantes', 'variante' => $n]);
            }
            $vistas[mb_strtolower($etiqueta)] = true;
            $variantes[] = ['etiqueta' => $etiqueta, 'precio' => $precio, 'precio_anterior' => $antes, 'stock' => $stock];
        }
        return $variantes;
    }

    /** "Collar antipulgas (perro)" → "collar-antipulgas-perro", con -2, -3… si ya existe. */
    private static function slugLibre(\PDO $db, string $nombre): string
    {
        $base = strtr(mb_strtolower($nombre), ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n']);
        $base = substr(trim(preg_replace('/[^a-z0-9]+/', '-', $base), '-'), 0, 100) ?: 'producto';
        $existe = $db->prepare('SELECT 1 FROM productos WHERE slug = ?');
        for ($n = 1, $slug = $base; ; $slug = "$base-" . ++$n) {
            $existe->execute([$slug]);
            if (!$existe->fetchColumn()) {
                return $slug;
            }
        }
    }
}
