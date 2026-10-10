#!/bin/bash
# Se carga con "source" desde el entrypoint de MariaDB (sin bit de ejecución) para tener docker_process_sql.
# security-audit-service · audit_db (instancia y volumen separados de las BD de negocio).

docker_process_sql <<-'EOSQL'
	CREATE DATABASE IF NOT EXISTS audit_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
	USE audit_db;

	CREATE TABLE security_audit_logs (
	    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	    timestamp      DATETIME(3) NOT NULL,
	    usuario_id     INT UNSIGNED NULL,
	    usuario_email  VARCHAR(120) NULL,
	    rol            ENUM('admin','cliente','anonimo') NOT NULL DEFAULT 'anonimo',
	    accion         VARCHAR(80) NOT NULL,
	    servicio       VARCHAR(50) NOT NULL,
	    pedido_id      CHAR(36) NULL,      -- UUID: los pedidos no usan IDs secuenciales (I de STRIDE)
	    pago_id        CHAR(36) NULL,
	    dato_anterior  JSON NULL,
	    dato_nuevo     JSON NULL,
	    ip_origen      VARCHAR(45) NULL,
	    user_agent     VARCHAR(255) NULL,
	    resultado      ENUM('EXITO','FALLO','FRAUDE') NOT NULL,
	    hash_anterior  CHAR(64) NOT NULL,  -- cadena de hashes SHA-256 (evidencia de manipulación)
	    hash           CHAR(64) NOT NULL,
	    KEY ix_accion (accion),
	    KEY ix_timestamp (timestamp),
	    KEY ix_usuario (usuario_id),
	    KEY ix_pedido (pedido_id)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

	-- Append-only a nivel de BD: ni siquiera root puede modificar o borrar filas sin quitar antes el trigger.
	CREATE TRIGGER trg_audit_sin_update BEFORE UPDATE ON security_audit_logs FOR EACH ROW
	    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'security_audit_logs es append-only: UPDATE prohibido';
	CREATE TRIGGER trg_audit_sin_delete BEFORE DELETE ON security_audit_logs FOR EACH ROW
	    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'security_audit_logs es append-only: DELETE prohibido';
EOSQL

docker_process_sql <<-EOSQL
	CREATE USER IF NOT EXISTS 'audit_user'@'%' IDENTIFIED BY '${AUDIT_DB_PASSWORD}';
	-- Solo INSERT y SELECT: el servicio no puede modificar ni borrar la bitácora.
	GRANT SELECT, INSERT ON audit_db.security_audit_logs TO 'audit_user'@'%';
EOSQL
