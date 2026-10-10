#!/usr/bin/env bash
# Respaldo cifrado de todas las bases (A.8.13 / BCP-DRP).
#   ops/backup.sh                 → backups/<fecha>/ con negocio.sql.gz.enc, auditoria.sql.gz.enc y SHA256SUMS
#   BACKUP_DIR=/ruta ops/backup.sh
# Cifrado: AES-256-CBC con PBKDF2 (200 000 iteraciones) y sal aleatoria; la clave es BACKUP_PASSPHRASE del .env.
# Si BACKUP_S3_BUCKET está definido, se sube también a S3 / Cloudflare R2 (BACKUP_S3_ENDPOINT).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${BACKUP_PASSPHRASE:?falta BACKUP_PASSPHRASE en .env}"

DESTINO="${BACKUP_DIR:-backups}/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DESTINO"
chmod 700 "${BACKUP_DIR:-backups}" "$DESTINO"
inicio=$(date +%s)

volcar() { # volcar <servicio> <clave root> <archivo> <bases...>
    local servicio=$1 clave=$2 archivo=$3; shift 3
    # MYSQL_PWD en el entorno del exec: la contraseña no aparece en la lista de procesos.
    docker compose exec -T -e MYSQL_PWD="$clave" "$servicio" \
        mariadb-dump -uroot --single-transaction --routines --triggers --events --hex-blob \
        --add-drop-database --databases "$@" \
      | gzip -9 \
      | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$DESTINO/$archivo"
}

echo "→ Bases de negocio (maestro): auth_db catalogo_db pedidos_db pagos_db"
volcar mariadb-master "$DB_ROOT_PASSWORD" negocio.sql.gz.enc auth_db catalogo_db pedidos_db pagos_db
echo "→ Bitácora (instancia de auditoría): audit_db"
volcar mariadb-audit "$AUDIT_DB_ROOT_PASSWORD" auditoria.sql.gz.enc audit_db

(cd "$DESTINO" && sha256sum *.enc > SHA256SUMS)
chmod 600 "$DESTINO"/*
echo "✔ Respaldo en $DESTINO ($(du -sh "$DESTINO" | cut -f1), $(( $(date +%s) - inicio )) s)"

if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
    echo "→ Subiendo a s3://$BACKUP_S3_BUCKET/$(basename "$DESTINO")/"
    docker run --rm -v "$PWD/$DESTINO:/respaldo:ro" \
        -e AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" -e AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" -e AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}" \
        amazon/aws-cli:2.17.0 s3 cp /respaldo "s3://$BACKUP_S3_BUCKET/$(basename "$DESTINO")/" --recursive \
        ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"}
fi

# Retención local (la remota la define la regla de ciclo de vida del bucket).
find "${BACKUP_DIR:-backups}" -mindepth 1 -maxdepth 1 -type d -mtime +"${BACKUP_RETENCION_DIAS:-30}" -exec rm -rf {} +
echo "$DESTINO"
