-- audit_db · roles del personal (veterinario, recepción, tienda). Sin esto, la bitácora rechaza sus
-- eventos. Solo amplía el ENUM: los registros y la cadena de hashes existentes no cambian.
-- Idempotente: ops/migrar-v2.sh lo aplica también a una base ya creada.
USE audit_db;
ALTER TABLE security_audit_logs
    MODIFY COLUMN rol ENUM('admin','cliente','anonimo','veterinario','recepcion','tienda') NOT NULL DEFAULT 'anonimo';
