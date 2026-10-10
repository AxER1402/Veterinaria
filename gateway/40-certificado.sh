#!/bin/sh
# En producción /etc/nginx/certs trae el certificado de Let's Encrypt (montado como volumen).
# En local, si no hay certificado, se genera uno autofirmado para poder probar HTTPS.
set -eu
DIR=/etc/nginx/certs
if [ ! -s "$DIR/fullchain.pem" ] || [ ! -s "$DIR/privkey.pem" ]; then
    mkdir -p "$DIR"
    echo "40-certificado: no hay certificado, se genera uno autofirmado para ${SERVER_NAME:-localhost}"
    openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
        -keyout "$DIR/privkey.pem" -out "$DIR/fullchain.pem" \
        -subj "/CN=${SERVER_NAME:-localhost}" >/dev/null 2>&1
fi
