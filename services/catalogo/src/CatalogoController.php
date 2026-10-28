<?php
declare(strict_types=1);

namespace App;

use Huellitas\ApiError;
use Huellitas\Auditoria;
use Huellitas\Cache;
use Huellitas\Db;
use Huellitas\Guard;
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
        Guard::usuario(['admin']);
        return [200, ['productos' => $this->consultar(Db::escritura(), soloActivos: false, admin: true)]];
    }

    /**
     * Alta de un producto con sus variantes. El slug y los SKU los pone el servidor; precios y stock
     * se validan igual que al editarlos. Registra PRODUCTO_CREADO.
     */
    public function crearProducto(): array
    {
        $claims = Guard::usuario(['admin']);
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

    /** Activar/desactivar, destacar o cambiar la imagen (solo Cloudinary propio). */
    public function actualizarProducto(int $id): array
    {
        $claims = Guard::usuario(['admin']);
        $datos = Http::body();

        $cambios = [];
        foreach (['activo', 'destacado'] as $campo) {
            if (array_key_exists($campo, $datos)) {
                if (!is_bool($datos[$campo])) {
                    throw new ApiError(422, "El campo $campo debe ser verdadero o falso", ['campo' => $campo]);
                }
                $cambios[$campo] = $datos[$campo] ? 1 : 0;
            }
        }
        if (array_key_exists('imagen_url', $datos)) {
            if (!is_string($datos['imagen_url']) || !Cloudinary::esPropia($datos['imagen_url'])) {
                throw new ApiError(422, 'La imagen debe estar subida a la cuenta de Cloudinary de la tienda', ['campo' => 'imagen_url']);
            }
            $cambios['imagen_url'] = $datos['imagen_url'];
            $cambios['imagen_public_id'] = is_string($datos['imagen_public_id'] ?? null) ? mb_substr($datos['imagen_public_id'], 0, 200) : null;
        }
        if (!$cambios) {
            throw new ApiError(422, 'No hay cambios que aplicar');
        }

        $db = Db::escritura();
        $antes = $db->prepare('SELECT activo, destacado, imagen_url FROM productos WHERE id = ?');
        $antes->execute([$id]);
        if (!$antes->fetch()) {
            throw new ApiError(404, 'Producto no encontrado');
        }
        // Las columnas salen de una lista fija; los valores van como parámetros.
        $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($cambios)));
        $db->prepare("UPDATE productos SET $set, updated_by = ? WHERE id = ?")
            ->execute([...array_values($cambios), (int) $claims['sub'], $id]);
        self::invalidar();

        return [200, ['producto' => $this->uno($id)]];
    }

    /** Cambio de precio y/o stock de una variante. Registra PRECIO_MODIFICADO y PRODUCTO_AGOTADO. */
    public function actualizarVariante(int $id): array
    {
        $claims = Guard::usuario(['admin']);
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
        Guard::usuario(['admin']);
        if (!Cloudinary::configurado()) {
            throw new ApiError(503, 'Cloudinary no está configurado (CLOUDINARY_* en .env)');
        }
        return [200, Cloudinary::firma()];
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
