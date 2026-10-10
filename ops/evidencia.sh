#!/usr/bin/env bash
# Regenera docs/evidencia/README.md con la salida real de los comandos de SEC-2, SEC-3 y SEC-5.
#   ops/evidencia.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
OUT=docs/evidencia/README.md
mkdir -p docs/evidencia
master() { docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb-master mariadb -uroot --table -e "$1"; }
audit()  { docker compose exec -T -e MYSQL_PWD="$AUDIT_DB_ROOT_PASSWORD" mariadb-audit mariadb -uroot --table audit_db -e "$1"; }

{
echo "# Evidencia de seguridad · $(date '+%Y-%m-%d %H:%M')"
echo
echo "Generado con \`ops/evidencia.sh\` contra el stack en ejecución. Las capturas del panel están en esta misma carpeta."
echo
echo "## SEC-2 · Bitácora: ≥ 30 registros y ≥ 8 tipos de evento"
echo
echo '```'
audit "SELECT COUNT(*) AS registros, COUNT(DISTINCT accion) AS tipos_de_evento FROM security_audit_logs"
audit "SELECT accion, resultado, COUNT(*) AS total FROM security_audit_logs GROUP BY accion, resultado ORDER BY accion, resultado"
echo '```'
echo
echo "Últimos 30 registros:"
echo
echo '```'
audit "SELECT id, timestamp, accion, resultado, servicio, COALESCE(usuario_email, rol) AS usuario, ip_origen, LEFT(hash, 12) AS hash
       FROM security_audit_logs ORDER BY id DESC LIMIT 30"
echo '```'
echo
echo "Append-only: incluso root recibe un error al intentar modificar la bitácora:"
echo
echo '```'
echo "MariaDB [audit_db]> UPDATE security_audit_logs SET resultado='EXITO' WHERE id = 1;"
audit "UPDATE security_audit_logs SET resultado='EXITO' WHERE id = 1" 2>&1 | grep -v '^--------------\|^UPDATE' | sed '/^$/d' || true
echo '```'
echo
echo "## SEC-3 · Sin datos de tarjeta en la base"
echo
echo '```'
echo "MariaDB> DESCRIBE pagos_db.pagos;"
master "DESCRIBE pagos_db.pagos"
echo "MariaDB> SELECT * FROM pagos_db.pagos;"
master "SELECT id, id_pedido, monto, moneda, metodo, payment_intent_id, stripe_status, estado, fecha_pago FROM pagos_db.pagos ORDER BY created_at DESC"
echo "MariaDB> -- columnas que parezcan de tarjeta en las 4 bases de negocio"
master "SELECT COUNT(*) AS columnas_de_tarjeta FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA IN ('auth_db','catalogo_db','pedidos_db','pagos_db')
          AND COLUMN_NAME REGEXP 'card|tarjeta|cvv|cvc|pan\$|expir|vencimiento|track'"
echo '```'
echo
echo "## SEC-5 · Hardening Docker"
echo
echo '```'
echo '$ docker ps --format "table {{.Names}}\t{{.Ports}}"'
docker ps --filter "label=com.docker.compose.project=huellitas" --format "table {{.Names}}\t{{.Ports}}"
echo
echo '$ docker ps | grep -E "0.0.0.0:(3306|6379)"   # sin resultados = BD y Redis no expuestos'
docker ps --filter "label=com.docker.compose.project=huellitas" --format '{{.Ports}}' | grep -E "0\.0\.0\.0:(3306|6379)" || echo "(sin resultados)"
echo
echo '$ docker compose exec auth-service whoami'
docker compose exec -T auth-service whoami
echo '```'
} > "$OUT"
echo "✔ $OUT"
