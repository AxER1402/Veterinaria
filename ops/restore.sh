#!/usr/bin/env bash
# Restaura un respaldo hecho con ops/backup.sh.
#   ops/restore.sh backups/20261010-101500              → negocio + bitácora
#   ops/restore.sh backups/20261010-101500 negocio      → solo bases de negocio (la réplica se actualiza sola)
#   ops/restore.sh backups/20261010-101500 auditoria    → solo audit_db
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${BACKUP_PASSPHRASE:?falta BACKUP_PASSPHRASE en .env}"
ORIGEN=${1:?uso: ops/restore.sh <carpeta de respaldo> [negocio|auditoria]}
QUE=${2:-todo}

echo "→ Verificando integridad (SHA-256)"
(cd "$ORIGEN" && sha256sum -c SHA256SUMS)

cargar() { # cargar <servicio> <clave root> <archivo>
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$ORIGEN/$3" \
      | gunzip \
      | docker compose exec -T -e MYSQL_PWD="$2" "$1" mariadb -uroot
}

if [[ $QUE == todo || $QUE == negocio ]]; then
    echo "→ Restaurando bases de negocio en el maestro"
    cargar mariadb-master "$DB_ROOT_PASSWORD" negocio.sql.gz.enc
fi
if [[ $QUE == todo || $QUE == auditoria ]]; then
    echo "→ Restaurando la bitácora"
    cargar mariadb-audit "$AUDIT_DB_ROOT_PASSWORD" auditoria.sql.gz.enc
fi
echo "✔ Restauración terminada"
