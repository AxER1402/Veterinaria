#!/usr/bin/env bash
# Aplica a un entorno ya levantado las migraciones de la versión 2 (historial ampliado, roles,
# agenda por servicio y pedidos con reembolsos), sin borrar datos. Se puede correr más de una vez:
#   ops/migrar-v2.sh && docker compose up -d --build
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Falta .env: corre ops/generar-env.sh" >&2; exit 1; }
set -a; source .env; set +a

docker compose up -d --wait mariadb-master mariadb-slave
for f in db/master/12-historial-ampliado.sql db/master/13-roles-telefono.sql db/master/14-citas-agenda-v2.sql db/master/15-pedidos-v2.sql db/master/16-resenas.sql db/master/17-monitor-replica.sql db/master/18-profesionales.sql db/master/19-alta-clientes.sql db/master/20-resenas-moderacion.sql db/master/21-pagos-reembolso.sql db/master/22-catalogo-fichas.sql; do
    echo "→ $f"
    docker compose exec -T mariadb-master mariadb -uroot -p"$DB_ROOT_PASSWORD" < "$f"
done
docker compose up -d --wait mariadb-audit
echo "→ db/audit/02-roles-personal.sql"
docker compose exec -T mariadb-audit mariadb -uroot -p"$AUDIT_DB_ROOT_PASSWORD" < db/audit/02-roles-personal.sql
echo "✔ Migraciones v2 aplicadas. Siguiente: docker compose up -d --build --wait"
