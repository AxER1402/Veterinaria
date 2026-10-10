#!/usr/bin/env bash
# Paso 3 en el VPS: agrega el bloque 443 del dominio, que pasa el tráfico al gateway de Huellitas.
#   DOMINIO=huellitas.fadeappgt.com bash ops/vps/3-nginx-https.sh
set -euo pipefail
DOMINIO=${DOMINIO:?define DOMINIO}
CONF=${CONF:-/root/SGA/docker/nginx/prod.conf}
NGINX=${NGINX:-sga_nginx_prod}

docker exec "$NGINX" test -s "/etc/letsencrypt/live/$DOMINIO/fullchain.pem" || { echo "Falta el certificado: corre antes 2-nginx-http.sh"; exit 1; }
cp "$CONF" "$CONF.antes-huellitas-https-$(date +%Y%m%d-%H%M%S)"
cat >> "$CONF" <<NGINX

# ---------- Huellitas ($DOMINIO) · puerto 443 ----------
server {
    listen 443 ssl;
    http2 on;
    server_name $DOMINIO;
    ssl_certificate     /etc/letsencrypt/live/$DOMINIO/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMINIO/privkey.pem;
    ssl_protocols TLSv1.3;
    client_max_body_size 1m;

    location / {
        # Con variable + resolver el nombre se resuelve en cada petición: si Huellitas está apagado,
        # el Nginx del SGA igual arranca.
        resolver 127.0.0.11 valid=10s ipv6=off;
        set \$huellitas https://huellitas-web:443;
        proxy_pass \$huellitas;
        proxy_ssl_verify off;              # certificado interno del gateway (tráfico dentro de Docker)
        proxy_ssl_server_name on;
        proxy_ssl_name $DOMINIO;
        proxy_set_header Host \$host;
        # Huellitas toma la IP del cliente SOLO de X-Real-IP, que aquí se sobrescribe siempre.
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
NGINX
docker exec "$NGINX" nginx -t && docker exec "$NGINX" nginx -s reload
sleep 2
echo "Comprobación:"
curl -s -o /dev/null -w "  https://$DOMINIO/tienda → %{http_code}\n" "https://$DOMINIO/tienda"
curl -s -o /dev/null -w "  http://$DOMINIO/        → %{http_code} (redirección)\n" "http://$DOMINIO/"
echo "✔ Listo. Recuerda: cambiar la contraseña de admin@huellitas.gt, activar su MFA e instalar el cron de respaldos."
