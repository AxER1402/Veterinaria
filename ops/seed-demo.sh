#!/usr/bin/env bash
# Carga los datos de demostración (db/seeds): clientes, mascotas, citas, historial clínico, vacunas,
# pedidos y pagos relacionados entre sí. Solo para desarrollo y demos:
#   ops/seed-demo.sh
# Se puede correr más de una vez (no duplica nada). No borra datos.
# Ojo: si después corres tests/seguridad.sh, las citas sembradas ocupan turnos de la agenda.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Falta .env: corre ops/generar-env.sh" >&2; exit 1; }
set -a; source .env; set +a

docker compose up -d --wait mariadb-master mariadb-slave
for f in db/seeds/*.sql; do
    echo "→ $f"
    # PayPal cobra en dólares: los pagos de demo usan el mismo tipo de cambio que pagos-service.
    { echo "SET @tipo_cambio := ${PAYPAL_TIPO_CAMBIO:-7.75};"; cat "$f"; } \
        | docker compose exec -T mariadb-master mariadb -uroot -p"$DB_ROOT_PASSWORD" --table
done
echo "✔ Datos de demo cargados. Las cuentas están en usuarios.md (contraseña Cliente#2026)."
