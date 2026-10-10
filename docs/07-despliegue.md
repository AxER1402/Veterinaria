# Huellitas — Despliegue en producción

Requisitos: un servidor Linux con Docker y Compose v2, un dominio apuntando a su IP (idealmente a través del proxy de Cloudflare) y el `.env` con secretos **nuevos**. Nunca se reutilizan los de desarrollo.

## 1. Preparar el servidor

```bash
git clone <repo> /srv/huellitas && cd /srv/huellitas
cp .env.example .env && chmod 600 .env
# Generar cada secreto vacío:
for v in JWT_SECRET SERVICE_JWT_SECRET REDIS_PASSWORD DB_ROOT_PASSWORD DB_REPLICATION_PASSWORD AUTH_DB_PASSWORD \
         CATALOGO_DB_PASSWORD PEDIDOS_DB_PASSWORD PAGOS_DB_PASSWORD AUDIT_DB_ROOT_PASSWORD AUDIT_DB_PASSWORD \
         COMPROBANTE_SECRET BACKUP_PASSPHRASE; do
  sed -i "s|^$v=$|$v=$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-48)|" .env
done
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

> Con un proxy delante, `$remote_addr` del gateway es la IP del proxy. Para que el rate limit y la bitácora vean la IP real, agrega a `gateway/default.conf.template`:
> `set_real_ip_from 172.16.0.0/12; real_ip_header X-Real-IP;` (o `CF-Connecting-IP` si está detrás de Cloudflare).

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
