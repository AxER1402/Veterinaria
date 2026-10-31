-- auth-service · inicio de sesión con Google. `sub` es el identificador fijo de la cuenta de Google:
-- el correo puede cambiar. Es NULL en las cuentas con contraseña.
-- Idempotente: ops/migrar-v2.sh lo aplica también a una base ya creada.
USE auth_db;

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255) NULL COMMENT 'Cuenta de Google vinculada; solo clientes',
    ADD UNIQUE INDEX IF NOT EXISTS uq_usuarios_google (google_sub);
