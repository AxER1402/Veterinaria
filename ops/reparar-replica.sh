#!/usr/bin/env bash
# Vuelve a sincronizar la réplica (mariadb-slave) desde cero con una copia del maestro.
# Para cuando la replicación se rompe sin arreglo, p. ej. «Slave_IO_Running: No» con el error 1236
# (el maestro ya borró el binlog que la réplica necesitaba).
#   ops/reparar-replica.sh
# No toca el maestro (la copia es con --single-transaction, sin bloquear tablas). Mientras corre, los
# servicios leen del maestro solos (Db::lectura() detecta la réplica detenida).
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Falta .env" >&2; exit 1; }
set -a; source .env; set +a
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

esclavo() { docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb-slave mariadb -uroot "$@"; }

echo "→ Estado actual de la réplica:"
esclavo -e "SHOW SLAVE STATUS\G" | grep -E "Slave_(IO|SQL)_Running:|Last_(IO_)?Error:|Seconds_Behind" || true

echo "→ Copia del maestro con la posición GTID…"
docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb-master mariadb-dump -uroot \
    --databases auth_db catalogo_db pedidos_db pagos_db citas_db mysql \
    --single-transaction --gtid --master-data=2 --routines --triggers --events > "$tmp/copia.sql"
gtid=$(grep -oE "gtid_slave_pos='[^']*'" "$tmp/copia.sql" | head -1 | cut -d"'" -f2)
[[ -n "$gtid" ]] || { echo "La copia no trae la posición GTID; no se toca la réplica." >&2; exit 1; }
echo "  $(du -h "$tmp/copia.sql" | cut -f1), GTID $gtid"

echo "→ Cargando la copia en la réplica…"
esclavo -e "STOP SLAVE; RESET SLAVE;"
esclavo < "$tmp/copia.sql"
# La copia trae los usuarios del maestro, y con ellos su healthcheck: otra contraseña y sin REPLICA MONITOR.
# Sin esto la réplica replica bien pero queda «unhealthy», y `docker compose up --wait` falla.
docker compose exec -T mariadb-master cat /var/lib/mysql/.my-healthcheck.cnf \
    | docker compose exec -T mariadb-slave sh -c 'cat > /var/lib/mysql/.my-healthcheck.cnf'
esclavo -e "FLUSH PRIVILEGES; GRANT REPLICA MONITOR ON *.* TO 'healthcheck'@'localhost', 'healthcheck'@'127.0.0.1', 'healthcheck'@'::1';"
esclavo -e "SET GLOBAL gtid_slave_pos = '$gtid'; CHANGE MASTER TO MASTER_USE_GTID = slave_pos; START SLAVE;"

for _ in $(seq 1 15); do
    if esclavo -e "SHOW SLAVE STATUS\G" | grep -q "Slave_SQL_Running: Yes" && esclavo -e "SHOW SLAVE STATUS\G" | grep -q "Slave_IO_Running: Yes"; then
        echo "✔ Réplica sincronizada:"; esclavo -e "SHOW SLAVE STATUS\G" | grep -E "Slave_(IO|SQL)_Running:|Seconds_Behind"
        docker compose exec -T mariadb-slave healthcheck.sh --connect --replication_io --replication_sql --replication \
            || { echo "✘ La réplica replica, pero su healthcheck falla." >&2; exit 1; }
        echo "✔ Healthcheck de la réplica correcto"
        exit 0
    fi
    sleep 2
done
echo "✘ La réplica no arrancó. Revisa: docker compose exec mariadb-slave mariadb -uroot -p -e 'SHOW SLAVE STATUS\\G'" >&2
exit 1
