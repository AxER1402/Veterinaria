-- citas-service · FASE 15 A3: agenda del admin y correo de la cita.
-- Idempotente: ops/migrar-citas.sh lo aplica también a una base ya creada.
USE citas_db;

-- R de STRIDE: código HMAC que va en el correo; con COMPROBANTE_SECRET se puede recalcular.
ALTER TABLE citas ADD COLUMN IF NOT EXISTS codigo_verificacion CHAR(19) NULL AFTER notas;

-- Un bloqueo no se borra (citas_user no tiene DELETE): se desactiva y queda quién lo quitó.
ALTER TABLE turnos_bloqueados
    ADD COLUMN IF NOT EXISTS activo TINYINT(1) NOT NULL DEFAULT 1 AFTER motivo,
    ADD COLUMN IF NOT EXISTS quitado_por INT UNSIGNED NULL AFTER created_at,
    ADD COLUMN IF NOT EXISTS quitado_at DATETIME NULL AFTER quitado_por;
