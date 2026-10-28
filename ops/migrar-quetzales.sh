#!/usr/bin/env bash
# Pasa a quetzales un entorno que ya estaba levantado con precios en dólares, sin borrar datos:
#   ops/migrar-quetzales.sh
# 1. Agrega PAYPAL_TIPO_CAMBIO al .env si falta (PayPal no cobra en quetzales: cobra en USD).
# 2. Convierte el catálogo (×7.75, redondeado a Q5, igual que db/master/03) y los precios de los servicios.
# 3. Vuelve a valorar los pedidos existentes con esos precios y el envío en quetzales; en cada pago
#    queda lo que de verdad cobró la pasarela (USD) en monto_pasarela.
# Todo va en una transacción y solo corre una vez: la marca es la moneda por defecto de pagos
# (USD antes, GTQ después). En una instalación nueva no hace falta: ya nace en quetzales.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Falta .env: corre ops/generar-env.sh" >&2; exit 1; }

if ! grep -q '^PAYPAL_TIPO_CAMBIO=.' .env; then
    printf '%s\n' '# PayPal no cobra en quetzales: cobra en dólares a este tipo de cambio (quetzales por 1 USD).' 'PAYPAL_TIPO_CAMBIO=7.75' >> .env
    echo "✔ PAYPAL_TIPO_CAMBIO=7.75 agregado al .env"
fi
set -a; source .env; set +a

docker compose up -d --wait mariadb-master mariadb-slave redis
sql() { docker compose exec -T mariadb-master mariadb -uroot -p"$DB_ROOT_PASSWORD" "$@"; }

moneda=$(sql -N -e "SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = 'pagos_db' AND TABLE_NAME = 'pagos' AND COLUMN_NAME = 'moneda'")
if [[ $moneda != *USD* ]]; then
    sql < db/master/11-quetzales.sql
    echo "✔ Ya estaba en quetzales: no se convirtió nada."
    exit 0
fi

{
    echo "ALTER TABLE pagos_db.pagos
              ADD COLUMN IF NOT EXISTS monto_pasarela  DECIMAL(10,2) NULL AFTER moneda,
              ADD COLUMN IF NOT EXISTS moneda_pasarela CHAR(3) NULL AFTER monto_pasarela;"
    cat <<'SQL'
START TRANSACTION;

-- Catálogo. precio_anterior va primero porque compara con el precio todavía en dólares.
UPDATE catalogo_db.producto_variantes
SET precio_anterior = IF(precio_anterior IS NOT NULL
                         AND ROUND(precio_anterior * 7.75 / 5) * 5 > GREATEST(5, ROUND(precio * 7.75 / 5) * 5),
                         ROUND(precio_anterior * 7.75 / 5) * 5, NULL),
    precio          = GREATEST(5, ROUND(precio * 7.75 / 5) * 5);

UPDATE citas_db.servicios SET precio_desde = CASE slug
    WHEN 'veterinaria'   THEN 250
    WHEN 'peluqueria'    THEN 200
    WHEN 'guarderia'     THEN 175
    WHEN 'hospedaje'     THEN 300
    WHEN 'paseos'        THEN 100
    WHEN 'entrenamiento' THEN 275
    ELSE ROUND(precio_desde * 7.75 / 5) * 5 END;

-- Pedidos: precios del catálogo en quetzales y las reglas de Totales.php (envío Q35, gratis desde Q400).
UPDATE pedidos_db.detalle_pedidos d JOIN catalogo_db.producto_variantes v ON v.id = d.variante_id
SET d.precio_unitario = v.precio, d.subtotal = v.precio * d.cantidad;

CREATE TEMPORARY TABLE pedidos_db.tmp_totales AS
SELECT d.pedido_id,
       SUM(d.subtotal) AS subtotal,
       IFNULL(ROUND(SUM(IF(cu.marca IS NULL OR cu.marca = pr.marca, d.subtotal, 0)) * MAX(cu.porcentaje) / 100, 2), 0) AS descuento
FROM pedidos_db.detalle_pedidos d
JOIN pedidos_db.pedidos p ON p.id = d.pedido_id
JOIN catalogo_db.productos pr ON pr.id = d.producto_id
LEFT JOIN pedidos_db.cupones cu ON cu.codigo = p.cupon
GROUP BY d.pedido_id;

UPDATE pedidos_db.pedidos p JOIN pedidos_db.tmp_totales t ON t.pedido_id = p.id
SET p.subtotal   = t.subtotal,
    p.descuento  = t.descuento,
    p.envio      = IF(p.metodo_entrega = 'retiro' OR t.subtotal - t.descuento >= 400, 0, 35.00),
    p.total      = t.subtotal - t.descuento + IF(p.metodo_entrega = 'retiro' OR t.subtotal - t.descuento >= 400, 0, 35.00),
    p.updated_at = p.updated_at;

-- Pagos: lo que cobró la pasarela (USD) se guarda antes de pasar el monto al total en quetzales.
UPDATE pagos_db.pagos SET monto_pasarela = monto, moneda_pasarela = moneda, updated_at = updated_at
WHERE moneda = 'USD' AND monto_pasarela IS NULL;
UPDATE pagos_db.pagos g JOIN pedidos_db.pedidos p ON p.id = g.id_pedido
SET g.monto = p.total, g.moneda = 'GTQ', g.updated_at = g.updated_at
WHERE g.moneda = 'USD';

COMMIT;
SQL
    cat db/master/11-quetzales.sql
} | sql

# El catálogo público está en caché (Redis): cambiar la versión la deja obsoleta.
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning SETNX catalogo:version 1 >/dev/null
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INCR catalogo:version >/dev/null
echo "✔ Precios en quetzales. Siguiente: docker compose up -d --build --wait"
