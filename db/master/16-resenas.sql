-- catalogo-service · reseñas reales de clientes que compraron el producto.
-- Las calificaciones de productos eran cifras escritas a mano: desde aquí se calculan solo con
-- reseñas visibles (un producto sin reseñas queda en 0, «sin reseñas»).
-- Idempotente: ops/migrar-v2.sh lo aplica también a una base ya creada.
USE catalogo_db;

CREATE TABLE IF NOT EXISTS resenas (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    producto_id   INT UNSIGNED NOT NULL,
    id_cliente    INT UNSIGNED NOT NULL,              -- auth_db.usuarios.id (del JWT)
    autor         VARCHAR(60) NOT NULL,               -- «Lucía H.»: nombre e inicial, no el nombre completo
    calificacion  TINYINT UNSIGNED NOT NULL,
    comentario    VARCHAR(600) NULL,
    visible       TINYINT(1) NOT NULL DEFAULT 1,      -- la tienda puede ocultar una reseña (no se borra)
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_resena_cliente (producto_id, id_cliente),   -- una por cliente y producto (se edita)
    KEY ix_resenas_producto (producto_id, visible, created_at),
    CONSTRAINT ck_resena_calificacion CHECK (calificacion BETWEEN 1 AND 5),
    CONSTRAINT fk_resenas_producto FOREIGN KEY (producto_id) REFERENCES productos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE productos p
   SET p.calificacion = COALESCE((SELECT ROUND(AVG(r.calificacion), 1) FROM resenas r WHERE r.producto_id = p.id AND r.visible = 1), 0),
       p.resenas      = (SELECT COUNT(*) FROM resenas r WHERE r.producto_id = p.id AND r.visible = 1);
