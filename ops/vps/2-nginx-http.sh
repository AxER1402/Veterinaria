#!/usr/bin/env bash
# Paso 2 en el VPS: agrega al Nginx del SGA el bloque del puerto 80 del dominio (desafío ACME y
# redirección a https) y saca el certificado con el certbot del SGA.
# Va en dos pasos a propósito: un bloque 443 que apunta a un certificado inexistente tumbaría el
# `nginx -t` y, con él, al SGA.
#   DOMINIO=huellitas.ejemplo.com EMAIL=tu@correo bash ops/vps/2-nginx-http.sh
set -euo pipefail
DOMINIO=${DOMINIO:?define DOMINIO}
EMAIL=${EMAIL:?define EMAIL para Let\'s Encrypt}
CONF=${CONF:-/root/SGA/docker/nginx/prod.conf}
NGINX=${NGINX:-sga_nginx_prod}
CERTBOT=${CERTBOT:-sga_certbot}

grep -q "server_name $DOMINIO;" "$CONF" && { echo "Ya hay un bloque para $DOMINIO en $CONF"; exit 1; }
cp "$CONF" "$CONF.antes-huellitas-$(date +%Y%m%d-%H%M%S)"
# prod.conf es un bind mount de archivo suelto: se agrega con >> (nunca sed -i, el contenedor seguiría viendo el viejo).
cat >> "$CONF" <<NGINX

# ---------- Huellitas ($DOMINIO) · puerto 80 ----------
server {
    listen 80;
    server_name $DOMINIO;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://\$host\$request_uri; }
}
NGINX
docker exec "$NGINX" nginx -t && docker exec "$NGINX" nginx -s reload
docker exec "$CERTBOT" certbot certonly --webroot -w /var/www/certbot -d "$DOMINIO" \
    --email "$EMAIL" --agree-tos --no-eff-email --non-interactive
echo "✔ Certificado emitido para $DOMINIO. Siguiente: bash ops/vps/3-nginx-https.sh"
