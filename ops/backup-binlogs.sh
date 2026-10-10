#!/usr/bin/env bash
# Archiva los binlogs cerrados del maestro (cifrados) para recuperar a un punto en el tiempo.
# Con cron cada 5 min, el RPO de la BD de negocio queda en ≤ 5 min (docs/04-bcp-drp.md).
#   ops/backup-binlogs.sh   → backups/binlogs/<instancia del maestro>/mysql-bin.NNNNNN.gz.enc (+ SHA256SUMS)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${BACKUP_PASSPHRASE:?falta BACKUP_PASSPHRASE en .env}"
# Cada volumen del maestro tiene un identificador propio: un maestro reconstruido vuelve a numerar
# sus binlogs desde mysql-bin.000001, y sin esto se mezclarían con los de la instancia anterior.
instancia() {
    docker compose exec -T mariadb-master sh -c \
        'f=/var/lib/mysql/.huellitas-instancia; [ -s "$f" ] || cat /proc/sys/kernel/random/uuid > "$f"; cat "$f"' | tr -d '\r\n'
}
DESTINO="${BACKUP_DIR:-backups}/binlogs/$(instancia)"
mkdir -p "$DESTINO" && chmod 700 "${BACKUP_DIR:-backups}/binlogs" "$DESTINO"
sql() { docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb-master mariadb -N -uroot -e "$1"; }

# Cierra el binlog en uso para que lo escrito hasta ahora quede en un archivo completo.
sql "FLUSH BINARY LOGS"
mapfile -t archivos < <(sql "SHOW BINARY LOGS" | awk '{print $1}')
unset 'archivos[-1]'   # el último es el nuevo, todavía abierto

nuevos=0
for f in "${archivos[@]}"; do
    [[ -f "$DESTINO/$f.gz.enc" ]] && continue
    docker compose exec -T mariadb-master cat "/var/lib/mysql/$f" \
      | gzip -9 \
      | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$DESTINO/$f.gz.enc"
    chmod 600 "$DESTINO/$f.gz.enc"
    nuevos=$((nuevos + 1))
done
(cd "$DESTINO" && sha256sum ./*.gz.enc > SHA256SUMS 2>/dev/null || true)

if [[ -n "${BACKUP_S3_BUCKET:-}" && $nuevos -gt 0 ]]; then
    docker run --rm -v "$PWD/$DESTINO:/binlogs:ro" \
        -e AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" -e AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" -e AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}" \
        amazon/aws-cli:2.17.0 s3 sync /binlogs "s3://$BACKUP_S3_BUCKET/binlogs/$(basename "$DESTINO")/" ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"}
fi
echo "✔ $nuevos binlog(s) nuevos archivados en $DESTINO"
