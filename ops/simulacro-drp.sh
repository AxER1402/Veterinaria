#!/usr/bin/env bash
# Simulacro DRP — escenario "ransomware en la BD maestra" (docs/04-bcp-drp.md, escenario 1).
#
# 1. Toma un respaldo cifrado completo. Después hay actividad (se registra un cliente) y se
#    archivan los binlogs, como haría el cron cada 5 min.
# 2. Incidente: destruye el maestro y la réplica (contenedores + volúmenes), como si el disco
#    hubiera quedado cifrado por un ransomware.
# 3. Detección: la API deja de responder.
# 4. Recuperación: maestro nuevo + respaldo completo + binlogs (PITR) + réplica nueva que se pone al día sola.
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
PROYECTO=$(docker compose config --format json | jq -r .name)

if [[ "${1:-}" != "--si" ]]; then
    read -r -p "Esto BORRA los volúmenes ${PROYECTO}_master_data y ${PROYECTO}_slave_data (se restauran del respaldo). ¿Seguir? [s/N] " r
    [[ $r == s || $r == S ]] || exit 1
fi

ahora() { date +%s.%N; }
seg() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }
sql() { docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$1" mariadb -N -uroot -e "$2"; }
CONTEO="SELECT CONCAT_WS(' ',
  (SELECT COUNT(*) FROM auth_db.usuarios), (SELECT COUNT(*) FROM catalogo_db.productos),
  (SELECT SUM(stock) FROM catalogo_db.producto_variantes), (SELECT COUNT(*) FROM pedidos_db.pedidos),
  (SELECT COUNT(*) FROM pedidos_db.detalle_pedidos), (SELECT COUNT(*) FROM pagos_db.pagos),
  (SELECT COUNT(*) FROM citas_db.mascotas), (SELECT COUNT(*) FROM citas_db.citas),
  (SELECT COUNT(*) FROM citas_db.historial_clinico), (SELECT COUNT(*) FROM citas_db.vacunas))"
esperar_sano() { until docker compose ps "$1" --format '{{.Status}}' | grep -q '(healthy)'; do sleep 1; done; }
api_ok() { [[ "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/pedidos/cupones/HUELLITAS10")" == 200 ]]; }
auditoria() {
    local t
    t=$(curl -sk -X POST -H 'Content-Type: application/json' -d '{"email":"admin@huellitas.gt","password":"Admin#2026"}' "$BASE/api/auth/login" | jq -r .token)
    curl -sk -H "Authorization: Bearer $t" "$BASE/api/auditoria/integridad" | jq -r '"\(.integra) \(.revisados)"'
}

echo "== 1. Respaldo cifrado completo"
t_respaldo=$(ahora)
respaldo=$(ops/backup.sh | tail -1)
t_respaldo_fin=$(ahora)

echo "== Actividad posterior al respaldo"
posterior="simulacro$(date +%s)@correo.gt"
curl -sk -o /dev/null -X POST -H 'Content-Type: application/json' \
    -d "{\"nombre\":\"Cliente posterior al respaldo\",\"email\":\"$posterior\",\"password\":\"Segura123\"}" "$BASE/api/auth/registro"
echo "   se registró $posterior (no está en el respaldo completo)"
ops/backup-binlogs.sh | tail -1

echo "== Estado justo antes del incidente"
antes=$(sql mariadb-master "$CONTEO")
audit_antes=$(auditoria)
echo "   usuarios productos stock pedidos líneas pagos mascotas citas consultas vacunas: $antes"
echo "   bitácora (íntegra, registros): $audit_antes"

echo "== 2. INCIDENTE: se destruyen maestro y réplica (contenedores y volúmenes)"
t_incidente=$(ahora)
docker compose stop mariadb-slave mariadb-master >/dev/null 2>&1
docker compose rm -f mariadb-slave mariadb-master >/dev/null 2>&1
# Los volúmenes llevan el nombre del proyecto de Compose (huellitas, o el de COMPOSE_PROJECT_NAME).
docker volume rm "${PROYECTO}_master_data" "${PROYECTO}_slave_data" >/dev/null

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
recuperado=$(sql mariadb-master "SELECT COUNT(*) FROM auth_db.usuarios WHERE email='$posterior'")
replica=$(sql mariadb-slave "$CONTEO")
audit_despues=$(auditoria)
ok=true
[[ "$antes" == "$despues" ]] || ok=false
[[ "$antes" == "$replica" ]] || ok=false
[[ "${audit_despues%% *}" == true ]] || ok=false
[[ "$recuperado" == 1 ]] || ok=false
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
| Restauración del respaldo + binlogs (PITR) | $(seg "$t_maestro" "$t_restaurado") s |
| Réplica nueva sincronizada y API operativa | $(seg "$t_restaurado" "$t_operativo") s |
| **RTO medido (detección → operativo)** | **$(seg "$t_deteccion" "$t_operativo") s** |

Objetivo de la BIA para la BD maestra: RTO 10 min · RPO 5 min.

## Verificación

| | usuarios · productos · stock · pedidos · líneas · pagos · mascotas · citas · consultas · vacunas |
|---|---|
| Antes del incidente | \`$antes\` |
| Maestro restaurado | \`$despues\` |
| Réplica reconstruida | \`$replica\` |

- Cambio posterior al respaldo completo (registro de \`$posterior\`): **$([[ $recuperado == 1 ]] && echo "recuperado desde los binlogs" || echo "PERDIDO")**.
- Bitácora antes: \`$audit_antes\` · después: \`$audit_despues\` (íntegra, registros). Al vivir en su propio volumen, el incidente no la alcanzó.
- Resultado: **$($ok && echo "RECUPERACIÓN COMPLETA, sin pérdida de datos" || echo "HAY DIFERENCIAS: revisar")**.
- Respaldo usado: \`$respaldo\` (verificado con SHA-256 antes de restaurar).

> RPO: el respaldo completo se complementa con los binlogs archivados (\`ops/backup-binlogs.sh\`, cron cada 5 min).
> Lo que se pierde en el peor caso es lo escrito desde el último archivado: **≤ 5 min**, como pide la BIA.
INFORME
echo "✔ Informe: $informe"
$ok
