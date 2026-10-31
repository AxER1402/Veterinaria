#!/usr/bin/env bash
# Corre tests/seguridad.sh en un contenedor Linux, contra el stack levantado. Para macOS, donde la suite
# no funciona directamente (bash 3.2, date y base64 de BSD, curl sin TLS 1.3).
#   tests/seguridad-en-contenedor.sh
# Ojo: igual que la suite, deja datos de prueba en la base (ver falta.md).
set -euo pipefail
cd "$(dirname "$0")/.."
raiz=$PWD
exec docker run --rm --network host \
    -v /var/run/docker.sock:/var/run/docker.sock -v "$raiz:$raiz" -w "$raiz" docker:cli sh -c '
    apk add -q bash curl jq git coreutils grep sed findutils openssl tzdata >/dev/null
    git config --global --add safe.directory "*"
    exec bash tests/seguridad.sh'
