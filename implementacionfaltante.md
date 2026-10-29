# Implementación de lo faltante

Registro de lo que se hace a partir de `falta.md`. Cada entrada dice qué se hizo, por qué y cómo comprobarlo.

## 2026-10-29 · Pruebas de seguridad y migración a quetzales

### 1. Primera corrida de `tests/seguridad.sh`

Resultado: 264 pasaron, 10 fallaron, todos en pagos. No eran fallas de seguridad del código, sino dos causas:

| Prueba | Causa |
|---|---|
| CP-26, CP-27, CP-29 (9 fallas) | La base local seguía en dólares: nunca se le aplicó `db/master/11-quetzales.sql`. `pagos_db.pagos` no tenía `monto_pasarela` ni `moneda_pasarela` y su moneda por defecto era `USD`. El webhook comparaba un evento en GTQ contra un pago en USD: rechazaba como fraude el pago válido y aceptaba el que venía en dólares. |
| CP-28 (1 falla) | Falso positivo: la búsqueda de columnas de tarjeta (`card…`) encontraba `citas_db.historial_clinico.frecuencia_cardiaca`. |

Datos antes de migrar: productos de 6.99 a 120.00, servicios en dólares (veterinaria 35) y 66 pagos en `USD`, de los cuales 34 estaban confirmados.

### 2. Corrección del falso positivo (CP-28)

`tests/seguridad.sh`: la consulta de CP-28 excluye `frecuencia_cardiaca` y mantiene el resto del patrón (`card|tarjeta|cvv|cvc|pan$|expir|vencimiento|track`), así que una columna de tarjeta nueva seguiría haciendo fallar la prueba.

### 3. Respaldo antes de migrar

- `ops/backup.sh` → `backups/20261029-052602/` (cifrado, 284 KB; posición del binlog `mysql-bin.000014:71295`).
- Se verificó con `sha256sum -c SHA256SUMS` y se descifró `negocio.sql.gz.enc` para confirmar que trae `pagos` y `producto_variantes`.
- Para volver atrás: `ops/restore.sh` con esa carpeta.

### 4. Migración a quetzales (`ops/migrar-quetzales.sh`)

Se hizo en una sola transacción y sin borrar datos:

- Catálogo ×7.75 redondeado a Q5: ahora va de Q55 a Q930.
- Servicios: veterinaria 250, peluquería 200, guardería 175, hospedaje 300, paseos 100, entrenamiento 275.
- Pedidos revalorados (envío Q35, gratis desde Q400).
- Los 66 pagos quedaron en `GTQ` con `moneda_pasarela = USD`, que es lo que de verdad cobró la pasarela.
- La moneda por defecto de `pagos` pasó a `GTQ`.
- Se invalidó la caché del catálogo en Redis.
- La réplica quedó al día (`Slave_IO/SQL_Running: Yes`, retraso 0, mismo precio máximo).

Después: `docker compose up -d --build --wait`.

### 5. Segunda corrida de `tests/seguridad.sh`

**274 pasaron, 0 fallaron**, incluida CP-36 (clima, con internet).

### 6. Documentación

`falta.md`:
- En «Cómo actualizar un entorno ya levantado» se agregó el paso de `migrar-quetzales.sh`, que `migrar-v2.sh` no incluye.
- Se reemplazó la nota de «no se corrió `tests/seguridad.sh`» por el resultado.

### Pendiente que sale de esto

- **Servidor:** si se levantó antes del cambio a quetzales y solo se corre `migrar-v2.sh`, quedaría igual que estaba la base local. Antes de actualizarlo hay que revisar `SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='pagos_db' AND TABLE_NAME='pagos' AND COLUMN_NAME='moneda'`. Si dice `USD`: correr `ops/backup.sh` y después `ops/migrar-quetzales.sh`.
- Valorar si `migrar-v2.sh` debería llamar a `migrar-quetzales.sh` (el script ya detecta solo si hace falta).

Commit: `cb3bf3f`.

## 2026-10-29 · Pagos sin claves (apartado 13 de `falta.md`)

### 1. Ocultar la tarjeta sin quitar Stripe

- Variable nueva `STRIPE_OCULTAR_TARJETA` (0 por defecto), en `docker-compose.yml` y `.env.example`.
- `Stripe::ofrecido()` = Stripe configurado y tarjeta no oculta.
- `/internal/pagos/metodos` y el inicio de un pago con tarjeta usan `ofrecido()`: con la tarjeta oculta no aparece en el checkout, e iniciar un pago con tarjeta responde 503.
- El webhook y los reembolsos de pagos con tarjeta ya hechos siguen usando `configurado()`, así que CP-26 a CP-28 no cambian.

### 2. `disable-funding=card` en PayPal

- `PaymentPanel.jsx` carga el SDK con `&disable-funding=card`.
- Comprobado con el SDK real (`client-id=test`):
  - sin el parámetro, los botones son `paypal, card`;
  - con el parámetro, solo `paypal`.

### 3. CSP y PayPal

Se sirvió una página con la misma CSP de `gateway/cabeceras_seguridad.inc`, se cargó el SDK real y se hizo clic en el botón (Chromium sin interfaz, `playwright-core`).

- `*.paypalobjects.com` **no** se bloquea: ya está en `img-src`.
- El botón se dibuja y la ventana llega a `https://www.sandbox.paypal.com/checkoutnow`.
- La CSP sí bloquea dos cosas que el SDK inyecta:
  - **Un `<style>` con el tamaño del botón.** Sin él, el botón quedaba de 300 px en vez de ocupar el ancho. No se agregó `'unsafe-inline'`: se copiaron esas reglas a `frontend/src/shop.css` (`.payment__paypal .paypal-buttons …`). Con la CSP, el botón ahora se ve igual que sin ella.
  - **Un script en línea** en la página y en la ventana emergente (un adorno de carga de PayPal). No impide pagar: la ventana llega a PayPal igual. Se deja bloqueado.
- Si algún día hace falta el script en línea, PayPal acepta `data-csp-nonce`. Eso requiere un nonce por petición en el nginx del gateway.

### 4. Aviso al cerrar la ventana de PayPal

- `onCancel` del SDK → aviso «Cerraste la ventana de PayPal sin terminar el pago. No se cobró nada: puedes intentarlo de nuevo.» (estilo suave, `role="status"`).
- Después se vuelven a mostrar los métodos de pago.
- Reintentar reutiliza la misma orden de PayPal (`PayPal-Request-Id` por pedido y monto).

### 5. Tipo de cambio automático

`services/pagos/src/TipoCambio.php` (nuevo):

- Con `PAYPAL_TIPO_CAMBIO_AUTO=1` (por defecto) consulta `TipoCambioDia` del Banco de Guatemala (SOAP, HTTPS verificado) y lo guarda 6 h en Redis (`paypal:tipo_cambio`).
- Si Banguat no responde, o la tasa sale del rango Q5–Q12, usa `PAYPAL_TIPO_CAMBIO`, lo deja anotado en el log y reintenta a los 10 min.
- El tiempo de espera es de 3 s, porque se consulta dentro de la petición de pago.
- El XML no se interpreta: los dos valores salen con una expresión regular (sin riesgo de XXE).
- Con `PAYPAL_TIPO_CAMBIO_AUTO=0` siempre usa el `.env`.

Dónde se usa:

- El pago de PayPal convierte con la tasa del momento y la guarda en `monto_pasarela`, así que un cambio de tasa no altera pagos ya iniciados.
- `PAGO_INICIADO` registra `tipo_cambio` y `tipo_cambio_fuente` en la bitácora.
- El checkout muestra, por ejemplo: «US$65.41 (Q7.64 por dólar, tipo de cambio de referencia del Banguat del 29/10/2026)».

Comprobado en el contenedor:

| Caso | Resultado |
|---|---|
| Automático | 7.64382 (Banguat, 29/10/2026); Q500 = US$65.41 |
| Caché | queda en Redis 6 h |
| `PAYPAL_TIPO_CAMBIO_AUTO=0` | 7.75 (fijo) |
| Banguat inaccesible (contenedor aparte con el dominio apuntando a una IP muerta) | 7.75 (fijo), con el log y nuevo intento en 10 min |

### 6. Pruebas

- Nuevo **CP-48** en `tests/seguridad.sh`:
  - el tipo de cambio está en rango (Banguat o fijo; sin internet también pasa);
  - con `AUTO=0` se usa el del `.env`;
  - `STRIPE_OCULTAR_TARJETA=1` deja Stripe configurado pero no ofrecido.
- Suite completa: **277 pasaron, 0 fallaron**.
- Frontend: `vite build` sin avisos nuevos (solo el conocido del bundle de más de 500 KB).

### 7. Documentación

- `falta.md`: apartado de pagos actualizado y variables nuevas.
- `README.md`: el tipo de cambio de PayPal ahora viene del Banguat.

### Pendiente de pagos

- Las claves sandbox de Stripe y PayPal (las tiene que crear el equipo). Con ellas falta probar un pago y un reembolso reales de punta a punta.

## Siguiente

Según `falta.md`:
- `docs/` (STRIDE, OWASP, ISO): eventos nuevos de la bitácora y roles nuevos;
- revisión de las pantallas nuevas en el navegador;
- `lazy()` para el panel.
