-- citas-service · eliminar una sede: sale del panel y del sitio, pero la fila se conserva para que sus
-- citas, cobros y bloqueos anteriores sigan diciendo dónde fueron. Idempotente: ops/migrar-v2.sh lo aplica.
USE citas_db;

ALTER TABLE sedes ADD COLUMN IF NOT EXISTS eliminada_el DATETIME NULL AFTER activa;
