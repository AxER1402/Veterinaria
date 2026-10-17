#!/usr/bin/env bash
# Agrega el módulo de citas (FASE 15) a un entorno que ya estaba levantado, sin borrar datos:
#   ops/migrar-citas.sh
# 1. Agrega CITAS_DB_PASSWORD al .env si falta.
# 2. Crea citas_db, su usuario y sus tablas en el maestro (la réplica las copia sola).
# En una instalación nueva no hace falta: lo hacen los init de db/master.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Falta .env: corre ops/generar-env.sh" >&2; exit 1; }

if ! grep -q '^CITAS_DB_PASSWORD=.' .env; then
    sed -i '/^CITAS_DB_PASSWORD=/d' .env
    echo "CITAS_DB_PASSWORD=$(openssl rand -base64 64 | tr -d '/+=\n' | cut -c1-48)" >> .env
    echo "✔ CITAS_DB_PASSWORD agregado al .env"
fi
set -a; source .env; set +a

docker compose up -d --wait mariadb-master mariadb-slave
{
    echo "CREATE DATABASE IF NOT EXISTS citas_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    echo "CREATE USER IF NOT EXISTS 'citas_user'@'%' IDENTIFIED BY '${CITAS_DB_PASSWORD}';"
    echo "ALTER USER 'citas_user'@'%' IDENTIFIED BY '${CITAS_DB_PASSWORD}';"
    echo "GRANT SELECT, INSERT, UPDATE ON citas_db.* TO 'citas_user'@'%';"
    cat db/master/07-citas_db.sql db/master/08-citas-agenda.sql
} | docker compose exec -T mariadb-master mariadb -uroot -p"$DB_ROOT_PASSWORD"
echo "✔ citas_db lista. Siguiente: docker compose up -d --build --wait"
