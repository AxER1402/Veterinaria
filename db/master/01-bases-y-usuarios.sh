#!/bin/bash
# Se carga con "source" desde el entrypoint de MariaDB (sin bit de ejecución) para tener docker_process_sql.
# Una base por microservicio y un usuario por servicio con permisos SOLO sobre su base
# (A.8.3 Restricción de acceso / A05). Las contraseñas vienen del .env.

docker_process_sql <<-EOSQL
	CREATE DATABASE IF NOT EXISTS auth_db      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
	CREATE DATABASE IF NOT EXISTS catalogo_db  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
	CREATE DATABASE IF NOT EXISTS pedidos_db   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
	CREATE DATABASE IF NOT EXISTS pagos_db     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

	CREATE USER IF NOT EXISTS 'auth_user'@'%'     IDENTIFIED BY '${AUTH_DB_PASSWORD}';
	CREATE USER IF NOT EXISTS 'catalogo_user'@'%' IDENTIFIED BY '${CATALOGO_DB_PASSWORD}';
	CREATE USER IF NOT EXISTS 'pedidos_user'@'%'  IDENTIFIED BY '${PEDIDOS_DB_PASSWORD}';
	CREATE USER IF NOT EXISTS 'pagos_user'@'%'    IDENTIFIED BY '${PAGOS_DB_PASSWORD}';

	GRANT SELECT, INSERT, UPDATE, DELETE ON auth_db.*     TO 'auth_user'@'%';
	GRANT SELECT, INSERT, UPDATE, DELETE ON catalogo_db.* TO 'catalogo_user'@'%';
	GRANT SELECT, INSERT, UPDATE, DELETE ON pedidos_db.*  TO 'pedidos_user'@'%';
	GRANT SELECT, INSERT, UPDATE ON pagos_db.*            TO 'pagos_user'@'%';
EOSQL
