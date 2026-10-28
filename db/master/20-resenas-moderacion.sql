-- catalogo-service · las reseñas se revisan antes de publicarse (moderación previa).
-- revisada = 0 → «en revisión» (no se ve); la tienda la publica (visible = 1) o la deja oculta.
-- Las reseñas que ya existían se consideran revisadas.
-- Idempotente: ops/migrar-v2.sh lo aplica también a una base ya creada.
USE catalogo_db;
ALTER TABLE resenas ADD COLUMN IF NOT EXISTS revisada TINYINT(1) NOT NULL DEFAULT 1 AFTER visible;
