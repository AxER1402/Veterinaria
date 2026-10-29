#!/usr/bin/env bash
# Demo del pago sin claves de Stripe: hace con un pedido real lo mismo que haría Stripe al cobrarlo.
#   ops/demo-pago-sin-claves.sh <id del pedido>     (el id se copia de «Mis pedidos» o de /admin/pedidos)
#
# Sin claves, pagos-service no puede crear el PaymentIntent. Este script deja en pagos_db la fila que se
# habría creado al iniciar el pago y luego envía el webhook payment_intent.succeeded tres veces: sin
# firma, con firma falsa y con la firma real (HMAC con STRIPE_WEBHOOK_SECRET, como Stripe). Solo la
# última pasa el pedido a «pagado». Es el mismo procedimiento que usa tests/seguridad.sh (CP-26), pero
# sin crear datos de prueba: solo para desarrollo y demos, nunca en producción.
set -euo pipefail
cd "$(dirname "$0")/.."
PEDIDO=${1:?uso: ops/demo-pago-sin-claves.sh <id del pedido>}
[[ $PEDIDO =~ ^[0-9a-f-]{36}$ ]] || { echo "El id del pedido no es un UUID: $PEDIDO" >&2; exit 1; }
set -a; source .env; set +a
B=${BASE:-https://localhost:${HTTPS_PORT:-8443}}
sql() { docker compose exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb-master mariadb -N -uroot -e "$1"; }

read -r ESTADO TOTAL <<<"$(sql "SELECT estado, total FROM pedidos_db.pedidos WHERE id='$PEDIDO'")"
[[ -n ${ESTADO:-} ]] || { echo "No existe el pedido $PEDIDO" >&2; exit 1; }
[[ $ESTADO == pendiente_pago ]] || { echo "El pedido está «$ESTADO»: solo se paga uno pendiente de pago" >&2; exit 1; }
echo "Pedido ${PEDIDO:0:8} · Q$TOTAL · $ESTADO"

PI="pi_demo_$(date +%s)"
sql "INSERT INTO pagos_db.pagos (id, id_pedido, id_cliente, monto, moneda, monto_pasarela, moneda_pasarela, metodo, payment_intent_id, stripe_status)
     SELECT UUID(), id, id_cliente, total, 'GTQ', total, 'GTQ', 'stripe', '$PI', 'requires_payment_method' FROM pedidos_db.pedidos WHERE id='$PEDIDO'"
CENTAVOS=$(jq -n "$TOTAL*100|round")
EVENTO=$(jq -cn --arg pi "$PI" --argjson c "$CENTAVOS" --arg p "$PEDIDO" --arg e "evt_demo_$(date +%s%N)" \
  '{id:$e, type:"payment_intent.succeeded", data:{object:{id:$pi, amount_received:$c, currency:"gtq", status:"succeeded", metadata:{pedido_id:$p}}}}')
webhook() { curl -sk -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' ${1:+-H "Stripe-Signature: $1"} -d "$EVENTO" "$B/api/pagos/webhook/stripe"; }

TS=$(date +%s)
FIRMA=$(printf '%s' "$TS.$EVENTO" | openssl dgst -sha256 -hmac "$STRIPE_WEBHOOK_SECRET" | awk '{print $2}')
echo "1) webhook sin firma       → $(webhook)   (bitácora: WEBHOOK_STRIPE_RECIBIDO, FALLO)"
echo "2) webhook con firma falsa → $(webhook "t=$TS,v1=$(printf 'f%.0s' {1..64})")   (bitácora: FRAUDE)"
echo "3) webhook firmado         → $(webhook "t=$TS,v1=$FIRMA")"
sleep 1
echo "Pedido ${PEDIDO:0:8} · $(sql "SELECT estado FROM pedidos_db.pedidos WHERE id='$PEDIDO'")   (bitácora: PAGO_CONFIRMADO y PEDIDO_ESTADO_CAMBIADO)"
