-- auth-service · alta de clientes desde el panel (quien llama o llega sin cuenta).
-- La cuenta nace con una contraseña temporal que el personal le entrega al cliente; en su primer
-- ingreso está obligado a cambiarla.
-- Idempotente: ops/migrar-v2.sh lo aplica también a una base ya creada.
USE auth_db;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_password TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash;
