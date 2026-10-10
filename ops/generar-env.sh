#!/usr/bin/env bash
# Crea un .env a partir de .env.example rellenando cada secreto vacío con 48 caracteres aleatorios.
#   ops/generar-env.sh               → .env (no sobrescribe uno existente)
#   ops/generar-env.sh ruta/.env     → en otra ruta (CI, sitio B…)
# Las claves de servicios externos (Stripe, PayPal, EmailJS, Cloudinary, Maps, S3) quedan vacías:
# se completan a mano.
set -euo pipefail
cd "$(dirname "$0")/.."
DESTINO=${1:-.env}
if [[ -e "$DESTINO" ]]; then
    echo "Ya existe $DESTINO: no se sobrescribe (bórralo a mano si de verdad quieres regenerarlo)." >&2
    exit 1
fi
SECRETOS='JWT_SECRET SERVICE_JWT_SECRET REDIS_PASSWORD DB_ROOT_PASSWORD DB_REPLICATION_PASSWORD AUTH_DB_PASSWORD
CATALOGO_DB_PASSWORD PEDIDOS_DB_PASSWORD PAGOS_DB_PASSWORD AUDIT_DB_ROOT_PASSWORD AUDIT_DB_PASSWORD
COMPROBANTE_SECRET BACKUP_PASSPHRASE'
aleatorio() { openssl rand -base64 64 | tr -d '/+=\n' | cut -c1-48; }

umask 077
while IFS= read -r linea; do
    clave=${linea%%=*}
    if [[ "$linea" == *= ]] && grep -qw "$clave" <<<"$SECRETOS"; then
        echo "$clave=$(aleatorio)"
    elif [[ "$linea" == "STRIPE_WEBHOOK_SECRET=" ]]; then
        # Local/CI: secreto propio para firmar webhooks de prueba; en producción va el whsec_ de Stripe.
        echo "STRIPE_WEBHOOK_SECRET=whsec_local_$(aleatorio)"
    else
        echo "$linea"
    fi
done < .env.example > "$DESTINO"
echo "✔ $DESTINO creado (permisos 600). Completa a mano las claves de servicios externos."
