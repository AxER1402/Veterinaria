#!/usr/bin/env bash
# Paso 1 en el VPS (como root): clona o actualiza Huellitas y lo levanta detrás del Nginx del SGA.
# No toca el SGA ni FadeApp.
#   DOMINIO=huellitas.fadeappgt.com bash ops/vps/1-levantar.sh
set -euo pipefail
DOMINIO=${DOMINIO:?define DOMINIO, p. ej. DOMINIO=huellitas.fadeappgt.com}
REPO=${REPO:-https://github.com/AxER1402/Veterinaria.git}
DIR=${DIR:-/root/Huellitas}
RED=${RED:-sga_sga_network}

[[ -d "$DIR/.git" ]] || git clone "$REPO" "$DIR"
cd "$DIR" && git pull --ff-only

# Subred de la red del proxy: solo de ahí se acepta X-Forwarded-For.
SUBRED=$(docker network inspect "$RED" --format '{{(index .IPAM.Config 0).Subnet}}')

[[ -f .env ]] || ops/generar-env.sh
fijar() { grep -q "^$1=" .env && sed -i "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env; }
fijar SERVER_NAME "$DOMINIO"
fijar PROXY_NETWORK "$RED"
fijar TRUSTED_PROXY "$SUBRED"
chmod 600 .env

docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build --wait --wait-timeout 600
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
echo
echo "✔ Huellitas corriendo en la red $RED como huellitas-web (subred de confianza $SUBRED)."
echo "  Siguiente: bash ops/vps/2-nginx-http.sh"
