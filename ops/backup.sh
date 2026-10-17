#!/usr/bin/env bash
# Respaldo cifrado de todas las bases (A.8.13 / BCP-DRP).
#   ops/backup.sh                 → backups/<fecha>/ con negocio.sql.gz.enc, auditoria.sql.gz.enc, SHA256SUMS
#                                   y posicion-binlog.txt (punto de partida para PITR con ops/backup-binlogs.sh)
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

volcar() { # volcar <servicio> <clave root> <archivo> <opciones extra> <bases...>
    local servicio=$1 clave=$2 archivo=$3 extra=$4; shift 4
    # MYSQL_PWD en el entorno del exec: la contraseña no aparece en la lista de procesos.
    # shellcheck disable=SC2086
    docker compose exec -T -e MYSQL_PWD="$clave" "$servicio" \
        mariadb-dump -uroot --single-transaction --routines --triggers --events --hex-blob \
        --add-drop-database $extra --databases "$@" \
      | tee >(grep -o "MASTER_LOG_FILE='[^']*', MASTER_LOG_POS=[0-9]*" | head -n1 > "$DESTINO/.posicion-$archivo") \
      | gzip -9 \
      | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$DESTINO/$archivo"
}

# Cada volumen del maestro tiene un identificador propio: un maestro reconstruido vuelve a numerar
# sus binlogs desde mysql-bin.000001, y sin esto se mezclarían con los de la instancia anterior.
instancia() {
    docker compose exec -T mariadb-master sh -c \
        'f=/var/lib/mysql/.huellitas-instancia; [ -s "$f" ] || cat /proc/sys/kernel/random/uuid > "$f"; cat "$f"' | tr -d '\r\n'
}

# --master-data=2 deja anotada (como comentario) la posición del binlog en el instante del volcado:
# desde ahí se aplican los binlogs archivados para recuperar hasta un minuto concreto (PITR).
echo "→ Bases de negocio (maestro): auth_db catalogo_db pedidos_db pagos_db citas_db"
volcar mariadb-master "$DB_ROOT_PASSWORD" negocio.sql.gz.enc "--master-data=2" auth_db catalogo_db pedidos_db pagos_db citas_db
echo "→ Bitácora (instancia de auditoría): audit_db"
volcar mariadb-audit "$AUDIT_DB_ROOT_PASSWORD" auditoria.sql.gz.enc "" audit_db
# El grep corre en una sustitución de procesos: se espera a que termine de escribir.
for _ in $(seq 50); do [[ -s "$DESTINO/.posicion-negocio.sql.gz.enc" ]] && break; sleep 0.1; done
mv "$DESTINO/.posicion-negocio.sql.gz.enc" "$DESTINO/posicion-binlog.txt" 2>/dev/null || true
[[ -s "$DESTINO/posicion-binlog.txt" ]] && echo "INSTANCIA='$(instancia)'" >> "$DESTINO/posicion-binlog.txt"
rm -f "$DESTINO"/.posicion-*
[[ -s "$DESTINO/posicion-binlog.txt" ]] && echo "  posición del binlog: $(cat "$DESTINO/posicion-binlog.txt")"

(cd "$DESTINO" && sha256sum *.enc > SHA256SUMS)
[[ -s "$DESTINO/posicion-binlog.txt" ]] || rm -f "$DESTINO/posicion-binlog.txt"
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
