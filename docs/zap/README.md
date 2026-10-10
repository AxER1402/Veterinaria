# OWASP ZAP — escaneos del gateway (SEC-4)

Escaneo pasivo *baseline* (spider + reglas pasivas) contra el gateway HTTPS:

```bash
docker run --rm --add-host host.docker.internal:host-gateway -v "$PWD/docs/zap:/zap/wrk:rw" \
  ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://host.docker.internal:8443 \
  -j -m 3 -r zap-baseline-N.html -J zap-baseline-N.json -w zap-baseline-N.md -I
```

En producción el objetivo es la URL pública (`-t https://<dominio>`).

| Corrida | Fecha | FAIL | WARN | PASS | Alto | Medio | Bajo | Info |
|---|---|---|---|---|---|---|---|---|
| [1](zap-baseline-1.html) | 2026-10-10 | 0 | 10 | 57 | 0 | 2 | 4 | 7 |
| [2](zap-baseline-2.html) | 2026-10-10 | 0 | 7 | 60 | 0 | **0** | 3 | 6 |

## Qué se corrigió entre la corrida 1 y la 2

| Alerta (corrida 1) | Riesgo | Corrección |
|---|---|---|
| CSP: style-src unsafe-inline | Medio | `style-src 'self'`. `'unsafe-inline'` queda solo en `style-src-attr` (atributos `style` de React), que no permite inyectar hojas ni `<style>` |
| Sub Resource Integrity Attribute Missing | Medio | Las fuentes (Fredoka, Readex Pro) se alojan en el sitio (`@fontsource`). Ya no se carga la hoja externa de Google Fonts, que no admite SRI |
| Permissions Policy Header Not Set (`/assets/*`) | Bajo | Las cabeceras pasaron a `gateway/cabeceras_seguridad.inc`, incluido también en `location /assets/` (un `add_header` local anulaba los del server) |
| Cross-Origin-Resource-Policy Missing | Bajo | `Cross-Origin-Resource-Policy: same-origin` |

## Riesgo residual aceptado (corrida 2)

| Alerta | Riesgo | Por qué se acepta |
|---|---|---|
| Cross-Origin-Embedder-Policy | Bajo | `require-corp` o `credentialless` bloquean los iframes de Stripe Elements, de los botones de PayPal y de Google Maps, que no envían las cabeceras necesarias. Sin COEP solo se pierde el aislamiento entre orígenes (`SharedArrayBuffer`), que la tienda no usa |
| Cross-Origin-Opener-Policy | Bajo | Se usa `same-origin-allow-popups` en lugar de `same-origin` porque PayPal abre una ventana emergente para el login. Igual protege contra que otra página controle la ventana de la tienda |
| Timestamp Disclosure - Unix | Bajo | Falso positivo: números de 10 dígitos dentro del bundle minificado de React, no fechas del servidor |
| Information in Browser localStorage | Info | Carrito y favoritos (IDs de producto y cantidades). El JWT **no** se guarda ahí, sino en `sessionStorage`, que se borra al cerrar la pestaña |
| Suspicious Comments | Info | Textos dentro de librerías minificadas (React Router), sin datos internos |
| Cache-control / Storable / Retrieved from Cache / Modern Web App | Info | `/assets/*` tienen hash en el nombre y se cachean un año a propósito. La API responde `Cache-Control: no-store` |
