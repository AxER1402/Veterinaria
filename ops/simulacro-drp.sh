#!/usr/bin/env bash
# Simulacro DRP — escenario "ransomware en la BD maestra" (docs/04-bcp-drp.md, escenario 1).
#
# 1. Toma un respaldo cifrado.
# 2. Incidente: destruye el maestro y la réplica (contenedores + volúmenes), como si el disco
#    hubiera quedado cifrado por un ransomware.
# 3. Detección: la API deja de responder.
# 4. Recuperación: maestro nuevo + restauración del respaldo + réplica nueva que se pone al día sola.
# 5. Verificación: mismos conteos que antes, en el maestro y en la réplica; la bitácora (en su
#    propio volumen) no se tocó y su cadena de hashes sigue íntegra.
#
# Deja un informe con los tiempos medidos (RTO) en docs/simulacros/.
#   ops/simulacro-drp.sh            (pide confirmación)
#   ops/simulacro-drp.sh --si       (sin preguntar)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
BASE=${BASE:-https://localhost:${HTTPS_PORT:-8443}}

if [[ "${1:-}" != "--si" ]]; then
    read -r -p "Esto BORRA los volúmenes del maestro y la réplica (se restauran del respaldo). ¿Seguir? [s/N] " r
    [[ $r == s || $r == S ]] || exit 1
fi

ahora() { date +%s.%N; }
seg() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }
sql() { docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$1" mariadb -N -uroot -e "$2"; }
CONTEO="SELECT CONCAT_WS(' ',
  (SELECT COUNT(*) FROM auth_db.usuarios), (SELECT COUNT(*) FROM catalogo_db.productos),
  (SELECT SUM(stock) FROM catalogo_db.producto_variantes), (SELECT COUNT(*) FROM pedidos_db.pedidos),
  (SELECT COUNT(*) FROM pedidos_db.detalle_pedidos), (SELECT COUNT(*) FROM pagos_db.pagos))"
esperar_sano() { until docker compose ps "$1" --format '{{.Status}}' | grep -q '(healthy)'; do sleep 1; done; }
api_ok() { [[ "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/pedidos/cupones/HUELLITAS10")" == 200 ]]; }
auditoria() {
    local t
    t=$(curl -sk -X POST -H 'Content-Type: application/json' -d '{"email":"admin@huellitas.gt","password":"Admin#2026"}' "$BASE/api/auth/login" | jq -r .token)
    curl -sk -H "Authorization: Bearer $t" "$BASE/api/auditoria/integridad" | jq -r '"\(.integra) \(.revisados)"'
}

echo "== Estado inicial"
antes=$(sql mariadb-master "$CONTEO")
audit_antes=$(auditoria)
echo "   usuarios productos stock pedidos líneas pagos: $antes"
echo "   bitácora (íntegra, registros): $audit_antes"

echo "== 1. Respaldo cifrado"
t_respaldo=$(ahora)
respaldo=$(ops/backup.sh | tail -1)
t_respaldo_fin=$(ahora)

echo "== 2. INCIDENTE: se destruyen maestro y réplica (contenedores y volúmenes)"
t_incidente=$(ahora)
docker compose stop mariadb-slave mariadb-master >/dev/null 2>&1
docker compose rm -f mariadb-slave mariadb-master >/dev/null 2>&1
docker volume rm huellitas_master_data huellitas_slave_data >/dev/null

echo "== 3. Detección"
until ! api_ok; do sleep 1; done
t_deteccion=$(ahora)
echo "   la API de pedidos ya no responde (HTTP $(curl -sk -o /dev/null -w '%{http_code}' "$BASE/api/pedidos/cupones/HUELLITAS10"))"

echo "== 4. Recuperación"
docker compose up -d mariadb-master >/dev/null 2>&1
esperar_sano mariadb-master
t_maestro=$(ahora)
ops/restore.sh "$respaldo" negocio
t_restaurado=$(ahora)
docker compose up -d mariadb-slave >/dev/null 2>&1
esperar_sano mariadb-slave
# El stock cambió respecto a lo que pudiera haber en caché: se invalida el catálogo.
docker compose exec -T redis redis-cli INCR catalogo:version >/dev/null
until api_ok; do sleep 1; done
t_operativo=$(ahora)

echo "== 5. Verificación"
despues=$(sql mariadb-master "$CONTEO")
replica=$(sql mariadb-slave "$CONTEO")
audit_despues=$(auditoria)
ok=true
[[ "$antes" == "$despues" ]] || ok=false
[[ "$antes" == "$replica" ]] || ok=false
[[ "${audit_despues%% *}" == true ]] || ok=false
echo "   maestro: $despues · réplica: $replica · bitácora: $audit_despues → $($ok && echo OK || echo DIFERENCIAS)"

mkdir -p docs/simulacros
informe="docs/simulacros/$(date +%Y%m%d-%H%M)-ransomware-maestro.md"
cat > "$informe" <<INFORME
# Simulacro DRP — ransomware en la BD maestra · $(date '+%Y-%m-%d %H:%M')

Escenario 1 de [docs/04-bcp-drp.md](../04-bcp-drp.md). Ejecutado con \`ops/simulacro-drp.sh\`.

| Paso | Duración |
|---|---|
| Respaldo cifrado (AES-256) | $(seg "$t_respaldo" "$t_respaldo_fin") s |
| Incidente → detección (API caída) | $(seg "$t_incidente" "$t_deteccion") s |
| Maestro nuevo levantado | $(seg "$t_deteccion" "$t_maestro") s |
| Restauración del respaldo | $(seg "$t_maestro" "$t_restaurado") s |
| Réplica nueva sincronizada y API operativa | $(seg "$t_restaurado" "$t_operativo") s |
| **RTO medido (detección → operativo)** | **$(seg "$t_deteccion" "$t_operativo") s** |

Objetivo de la BIA para la BD maestra: RTO 10 min · RPO 5 min.

## Verificación

| | usuarios · productos · stock · pedidos · líneas · pagos |
|---|---|
| Antes del incidente | \`$antes\` |
| Maestro restaurado | \`$despues\` |
| Réplica reconstruida | \`$replica\` |

- Bitácora antes: \`$audit_antes\` · después: \`$audit_despues\` (íntegra, registros). Al vivir en su propio volumen, el incidente no la alcanzó.
- Resultado: **$($ok && echo "RECUPERACIÓN COMPLETA, sin pérdida de datos" || echo "HAY DIFERENCIAS: revisar")**.
- Respaldo usado: \`$respaldo\` (verificado con SHA-256 antes de restaurar).

> En el simulacro el respaldo se toma justo antes del incidente, así que el RPO es 0. En operación normal el
> respaldo completo es diario y el incremental cada 4 h (docs/04-bcp-drp.md §3). El RPO de 5 min de la BIA se
> logra conservando los binlogs del maestro en otro volumen o en S3 para recuperación a un punto en el tiempo.
INFORME
echo "✔ Informe: $informe"
$ok
