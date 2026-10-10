-- auth-service · MFA con TOTP (RFC 6238). En instalaciones nuevas corre después de 02-auth_db.sql;
-- en una base existente se aplica a mano:  mariadb < db/master/06-auth-mfa.sql
USE auth_db;

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS mfa_secreto     VARBINARY(128) NULL COMMENT 'Secreto TOTP cifrado con AES-256-GCM (MFA_ENCRYPTION_KEY)',
    ADD COLUMN IF NOT EXISTS mfa_activo      TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mfa_ultimo_paso BIGINT UNSIGNED NULL COMMENT 'Último paso de 30 s aceptado: un código no se puede usar dos veces';
