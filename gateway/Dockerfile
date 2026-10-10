# API Gateway: único punto de entrada. Sirve el frontend (React) y hace de reverse proxy
# hacia los microservicios, con rate limiting, WAF básico, cabeceras de seguridad y TLS 1.3.
# Contexto de build: la raíz del repositorio.

# ---------- Etapa 1: build del frontend ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
# Key pública de Google Maps Embed (restringida por dominio en Google Cloud). Opcional.
ARG VITE_GOOGLE_MAPS_KEY=
ENV VITE_GOOGLE_MAPS_KEY=${VITE_GOOGLE_MAPS_KEY}
RUN npm run build

# ---------- Etapa 2: Nginx ----------
FROM nginx:1.27-alpine
RUN apk add --no-cache openssl
COPY gateway/default.conf.template /etc/nginx/templates/default.conf.template
COPY gateway/proxy_comun.inc gateway/cabeceras_seguridad.inc /etc/nginx/conf.d/
COPY gateway/40-certificado.sh /docker-entrypoint.d/40-certificado.sh
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.d/40-certificado.sh

EXPOSE 80 443
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1/salud >/dev/null || exit 1
