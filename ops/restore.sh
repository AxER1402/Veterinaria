#!/usr/bin/env bash
# Restaura un respaldo hecho con ops/backup.sh.
#   ops/restore.sh backups/20261010-101500              → negocio + bitácora
#   ops/restore.sh backups/20261010-101500 negocio      → solo bases de negocio (la réplica se actualiza sola)
#   ops/restore.sh backups/20261010-101500 auditoria    → solo audit_db
#   ops/restore.sh backups/20261010-101500 negocio --hasta "2026-10-10 14:35:00"
#       → respaldo completo + binlogs archivados (ops/backup-binlogs.sh) hasta ese instante (PITR).
#         Sin --hasta pero con binlogs archivados, se aplican todos (lo más reciente posible).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${BACKUP_PASSPHRASE:?falta BACKUP_PASSPHRASE en .env}"
ORIGEN=${1:?uso: ops/restore.sh <carpeta de respaldo> [negocio|auditoria|todo] [--hasta "AAAA-MM-DD HH:MM:SS"] [--sin-binlogs]}
QUE=${2:-todo}
HASTA=""
BINLOGS=true
shift $(( $# >= 2 ? 2 : $# ))
while [[ $# -gt 0 ]]; do
    case $1 in
        --hasta) HASTA=$2; shift 2 ;;
        --sin-binlogs) BINLOGS=false; shift ;;
        *) echo "opción desconocida: $1" >&2; exit 2 ;;
    esac
done
DIR_BINLOGS=""

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

    # PITR: desde la posición anotada en el respaldo, se reaplican los cambios de los binlogs archivados.
    # Los binlogs que sirven son los de la instancia del maestro de la que salió el respaldo.
    if [[ -s "$ORIGEN/posicion-binlog.txt" ]]; then
        inst=$(sed -nE "s/^INSTANCIA='([^']*)'.*/\1/p" "$ORIGEN/posicion-binlog.txt")
        DIR_BINLOGS="$(dirname "$ORIGEN")/binlogs/$inst"
    fi
    if $BINLOGS && [[ -n "$DIR_BINLOGS" && -d "$DIR_BINLOGS" ]]; then
        archivo=$(sed -nE "s/.*MASTER_LOG_FILE='([^']*)'.*/\1/p" "$ORIGEN/posicion-binlog.txt")
        posicion=$(sed -nE 's/.*MASTER_LOG_POS=([0-9]+).*/\1/p' "$ORIGEN/posicion-binlog.txt")
        mapfile -t aplicar < <(cd "$DIR_BINLOGS" && ls mysql-bin.*.gz.enc 2>/dev/null | sed 's/\.gz\.enc$//' | sort | awk -v d="$archivo" '$0 >= d')
        if [[ ${#aplicar[@]} -gt 0 ]]; then
            echo "→ PITR: ${#aplicar[@]} binlog(s) desde $archivo:$posicion${HASTA:+ hasta $HASTA}"
            (cd "$DIR_BINLOGS" && sha256sum -c --ignore-missing --quiet SHA256SUMS)
            docker compose exec -T mariadb-master sh -c 'rm -rf /tmp/pitr && mkdir -p /tmp/pitr'
            for f in "${aplicar[@]}"; do
                openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$DIR_BINLOGS/$f.gz.enc" \
                  | gunzip | docker compose exec -T mariadb-master sh -c "cat > /tmp/pitr/$f"
            done
            # --start-position solo afecta al primer archivo; los siguientes se aplican completos.
            docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb-master sh -c \
                "mariadb-binlog --start-position=$posicion ${HASTA:+--stop-datetime='$HASTA'} $(printf '/tmp/pitr/%s ' "${aplicar[@]}") | mariadb -uroot && rm -rf /tmp/pitr"
        else
            echo "  (no hay binlogs archivados posteriores al respaldo)"
        fi
    fi
fi
if [[ $QUE == todo || $QUE == auditoria ]]; then
    echo "→ Restaurando la bitácora"
    cargar mariadb-audit "$AUDIT_DB_ROOT_PASSWORD" auditoria.sql.gz.enc
fi
echo "✔ Restauración terminada"
