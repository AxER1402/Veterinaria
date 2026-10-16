# Huellitas — Despliegue en producción

Requisitos: un servidor Linux con Docker y Compose v2, un dominio apuntando a su IP (idealmente a través del proxy de Cloudflare) y el `.env` con secretos **nuevos**. Nunca se reutilizan los de desarrollo.

## 1. Preparar el servidor

```bash
git clone <repo> /srv/huellitas && cd /srv/huellitas
ops/generar-env.sh          # .env con todos los secretos aleatorios (permisos 600)
# Completar a mano: SERVER_NAME, claves de Stripe/PayPal/EmailJS/Cloudinary/Maps y BACKUP_S3_*.
```

Guarda `BACKUP_PASSPHRASE` y el `.env` completo en el gestor de contraseñas: el sitio B los necesita.

## 2a. Servidor dedicado (el gateway atiende 80/443 directamente)

```bash
# .env: SERVER_NAME=tienda.ejemplo.com  HTTP_PORT=80  HTTPS_PORT=443
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Primer certificado (el gateway ya sirve /.well-known/acme-challenge/ en el puerto 80):
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot -d "$SERVER_NAME" --email admin@"$SERVER_NAME" --agree-tos --no-eff-email
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart gateway   # toma el certificado nuevo
```

Desde ahí, el contenedor `certbot` renueva solo y el gateway recarga Nginx cada 6 h.

## 2b. Servidor compartido (ya hay un Nginx atendiendo 80/443)

El gateway de Huellitas escucha en puertos internos del host y el Nginx existente le reenvía el tráfico del dominio:

```bash
# .env: SERVER_NAME=tienda.ejemplo.com  HTTP_PORT=8088  HTTPS_PORT=8443  PUBLIC_HTTPS_PORT=443
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

```nginx
# En el Nginx que ya existe (con su propio certificado para tienda.ejemplo.com):
server {
    listen 443 ssl;
    http2 on;
    server_name tienda.ejemplo.com;
    ssl_protocols TLSv1.3;
    # ssl_certificate … (certbot del Nginx existente)
    location / {
        proxy_pass https://127.0.0.1:8443;
        proxy_ssl_verify off;            # cert interno autofirmado, tráfico local
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
server { listen 80; server_name tienda.ejemplo.com; return 301 https://$host$request_uri; }
```

> Con un proxy delante, `$remote_addr` del gateway es la IP del proxy. Para que el rate limit y la bitácora vean la IP real del cliente, define en `.env` `TRUSTED_PROXY` con la IP desde la que llega el proxy (por ejemplo `172.17.0.1/32`, la puerta de enlace de Docker). Solo de esa dirección se acepta `X-Forwarded-For`, así que un cliente no puede falsear su IP. El Nginx de adelante debe enviar `proxy_set_header X-Real-IP $remote_addr;`: el gateway toma la IP solo de esa cabecera, que el proxy sobrescribe siempre, así que un cliente no puede inyectar otra.

## 2c. En el VPS compartido con el SGA y FadeApp (31.220.50.103)

El Nginx del SGA (`sga_nginx_prod`) ya tiene 80/443. Huellitas no publica puertos: se une a la red `sga_sga_network` con el alias `huellitas-web` (`docker-compose.proxy.yml`). Son tres scripts para pegar como root, en orden; cada uno dice cuál sigue:

```bash
# 0. DNS: registro A del dominio elegido (huellitas.ejemplo.com es solo un ejemplo) → IP del servidor
DOMINIO=huellitas.ejemplo.com bash ops/vps/1-levantar.sh                 # clona, genera .env y levanta (no toca el SGA)
DOMINIO=huellitas.ejemplo.com EMAIL=tu@correo bash ops/vps/2-nginx-http.sh   # bloque :80 + certificado
DOMINIO=huellitas.ejemplo.com bash ops/vps/3-nginx-https.sh               # bloque :443 → huellitas-web
```

- Los pasos 2 y 3 respaldan `prod.conf` antes de tocarlo, agregan con `>>` (es un bind mount de archivo suelto: nunca `sed -i`) y solo recargan si `nginx -t` pasa.
- Van separados porque un bloque 443 con un certificado inexistente tumbaría el `nginx -t` y, con él, al SGA.
- El `proxy_pass` usa variable + `resolver`: si Huellitas está apagado, el Nginx del SGA igual arranca.
- La IP real del cliente llega en `X-Real-IP` (el script la sobrescribe con `$remote_addr`) y el gateway solo la acepta desde la subred de `sga_sga_network` (`TRUSTED_PROXY`, que calcula el paso 1). Probado con un proxy de prueba: un `X-Forwarded-For` o `X-Real-IP` inventado por el cliente no llega a la bitácora (CP-35).
- Consumo: unos 200 MiB en reposo; los límites de memoria suman unos 3,4 GB como máximo.

## 3. Después de desplegar

| Paso | Comando |
|---|---|
| Comprobar que todo está sano | `docker compose ps` (todos `healthy`) |
| Ninguna BD ni Redis expuestos (SEC-5) | `docker ps --format '{{.Names}} {{.Ports}}' \| grep -E '3306\|6379'` → solo puertos internos |
| Pruebas de seguridad contra producción | `BASE=https://tienda.ejemplo.com HTTP=http://tienda.ejemplo.com tests/seguridad.sh` (los casos que inspeccionan contenedores se corren en el servidor) |
| ZAP contra la URL pública (SEC-4) | `docker run --rm -v "$PWD/docs/zap:/zap/wrk" ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://tienda.ejemplo.com -r zap-produccion.html` |
| Webhook de Stripe | Dashboard → Developers → Webhooks → `https://tienda.ejemplo.com/api/pagos/webhook/stripe`, eventos `payment_intent.succeeded` y `payment_intent.payment_failed`. Copiar el `whsec_…` a `.env` y `docker compose up -d pagos-service` |
| Respaldos automáticos | Instalar el cron de `docs/04-bcp-drp.md` §3 |
| Usuario admin | Cambiar la contraseña de `admin@huellitas.gt` (la del seed es pública en el README) |

## 4. Actualizar

```bash
git pull && ops/backup.sh && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Los cambios de esquema van en un SQL nuevo que se aplica a mano (`mariadb < db/master/0X-….sql`): los scripts de `db/` solo corren en un volumen vacío.
