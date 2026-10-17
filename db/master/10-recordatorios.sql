-- citas-service · FASE 15 C1: recordatorios.
-- Marca de «ya se intentó avisar»: el aviso sale una sola vez aunque la tarea corra cada 15 min
-- (o haya dos instancias), y si EmailJS falla no se llena la bitácora de reintentos.
-- Idempotente: ops/migrar-citas.sh lo aplica también a una base ya creada.
USE citas_db;

ALTER TABLE citas ADD COLUMN IF NOT EXISTS recordatorio_at DATETIME NULL AFTER codigo_verificacion;
ALTER TABLE vacunas ADD COLUMN IF NOT EXISTS aviso_at DATETIME NULL AFTER proxima_dosis;
