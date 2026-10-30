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

Commit: `aa18cf8`.

## 2026-10-29 · Documentación: roles del personal y eventos de la bitácora

### 1. Qué estaba desactualizado

- La bitácora tiene **38 tipos de evento** (`AuditController::EVENTOS`), pero los docs decían 27. Ningún doc mencionaba 19 de ellos: los 10 que listaba `falta.md`, más `PRODUCTO_CREADO`, `MFA_CONFIGURADO`, `MASCOTA_*`, `TURNO_DESBLOQUEADO`, `RECORDATORIO_ENVIADO`, etc.
- Los docs decían que solo el admin entra al panel (`Guard::usuario(['admin'])`). En el código hay cuatro roles del personal con grupos de permisos (`Guard::PERSONAL`, `CLINICA`, `VETERINARIO`, `TIENDA`).
- El guion decía que «un rol nuevo rompería el ENUM» de la bitácora, pero `db/audit/02-roles-personal.sql` ya lo había ampliado.
- **Ningún rol nuevo ni ninguno de los 10 eventos nuevos tenía prueba automática.** Los docs habrían afirmado controles sin evidencia.

### 2. Prueba nueva CP-49 (roles del personal)

En `tests/seguridad.sh`, un usuario temporal pasa por `veterinario`, `recepcion` y `tienda`. En cada rol:

- inicia sesión de nuevo y entra al panel;
- debe llegar (no 403) a las rutas de su trabajo y recibir 403 en las demás.

| Ruta | Pueden entrar |
|---|---|
| `/api/pedidos/admin/todos`, `/api/catalogo/admin/productos` | tienda |
| `/api/citas/admin/semana` | veterinario, recepción |
| historial clínico | veterinario |
| `/api/auth/admin/clientes` | los tres |
| exportar clientes, personal, bitácora | ninguno (solo admin) |

Además comprueba:

- el personal no puede cambiar roles (403), el admin no puede cambiar el suyo (409) y un rol inexistente da 422;
- `ROL_CAMBIADO` guarda quién, el rol anterior y el nuevo;
- al volver a `cliente`, el usuario ya no entra al panel;
- el cambio de contraseña: con la actual equivocada da 422 y con la correcta da 200; `PASSWORD_CAMBIADO` no trae la contraseña, y la vieja deja de servir.

La prueba del rol propio del admin manda `"rol":"admin"`: si el control fallara, el admin igual se quedaría con su rol.

Resultado de la suite: **295 pasaron, 0 fallaron** (49 casos).

### 3. Cambios en los docs

- `docs/02-owasp-top10.md`:
  - fila A01: grupos de roles y CP-49;
  - control 4 y «Rutas del personal» actualizados;
  - subsección nueva **«A01 en los roles del personal»** (tabla de grupos y controles);
  - fila A09: 38 tipos;
  - sección nueva **«A09 — Catálogo de eventos de la bitácora»** con los 38 eventos: servicio, cuándo, resultado y prueba; ✱ marca los agregados después de la FASE 15.
- `docs/01-arquitectura-stride-dfd.md`:
  - historial clínico con `Guard::VETERINARIO`, agenda con `Guard::CLINICA`, panel por rol;
  - 6 filas STRIDE nuevas: E (roles del personal), S (contraseña temporal), T (adendas del historial), T (tipo de cambio de PayPal), R (reembolsos), R (reprogramación);
  - leyenda 🟡 = probado a mano, sin prueba automática.
- `docs/06-iso27001.md`: A.5.15 (roles), A.5.34 (admin y veterinario, adendas, reseñas con inicial), A.8.5 (contraseña temporal), A.8.15 (38 eventos), A.8.25 (295 comprobaciones en 49 casos).
- `docs/03-pci-dss-pagos.md`: `PAGO_REEMBOLSADO` en el logging; flujo de reembolsos; cobro de PayPal con `monto_pasarela`.
- `docs/04-bcp-drp.md`: los datos de salud los leen el admin y el veterinario. En el escenario 6 (credenciales de admin robadas), la detección y la respuesta incluyen `ROL_CAMBIADO` y los reembolsos.
- `docs/08-guion-presentacion.md`:
  - 295 pruebas;
  - respuesta corregida sobre quién ve diagnósticos;
  - pregunta nueva sobre los roles;
  - la respuesta del ENUM ahora justifica la ampliación.
- `README.md`: 38 tipos, CP-01 a CP-49 y 295 comprobaciones.

### 4. Para decidir

- **ENUM de `rol` en la bitácora.** El enunciado define `rol ENUM(admin,cliente,anonimo)`, y el proyecto lo amplió con los tres roles del personal (antes de esta sesión). Los docs lo presentan como una desviación justificada: registrar al personal como `admin` ocultaría quién hizo qué. Si se prefiere apegarse al enunciado, la alternativa sería registrar `admin` en `rol` y el rol real dentro de `dato_nuevo`.
- **Ocho eventos sin prueba automática:** `REEMBOLSO_PENDIENTE`, `REEMBOLSO_REGISTRADO`, `PAGO_REEMBOLSADO`, `PRODUCTO_ACTUALIZADO`, `RESENA_PUBLICADA`, `CITA_REPROGRAMADA`, `PROFESIONAL_ACTUALIZADO` y `HISTORIAL_CORREGIDO`.
- **PDF SEC-1:** hay que regenerarlo con los docs nuevos.

Commit: `120fa9b`.

## 2026-10-29 · Pruebas de los ocho eventos que faltaban

### 1. CP-50 · Reembolsos, reseñas y edición del catálogo

Pedidos pagados con el mismo método que CP-26: fila en `pagos` y webhook firmado. Se comprobó:

**Reembolsos**

- **`REEMBOLSO_PENDIENTE` (cancelación):** un cliente no puede cancelar desde el panel (403). Si el admin cancela un pedido pagado, queda `cancelado` con el reembolso pendiente, y el evento guarda el motivo y quién canceló.
- **`REEMBOLSO_PENDIENTE` (pago tardío):** el cliente cancela su pedido sin pagar y luego llegan **dos** avisos de pago de la pasarela. El pedido sigue cancelado, con reembolso pendiente, y el evento queda **una sola vez**.
- **Sin claves:**
  - reembolsar por la pasarela responde 503 y el reembolso sigue pendiente;
  - `catalogo-service` no puede llamar a `/internal/pagos/reembolsar` (403).
- **`REEMBOLSO_REGISTRADO`:**
  - un cliente no puede registrarlo (403) y una referencia con XSS da 400;
  - el admin lo registra: queda `hecho`, y el evento guarda quién y la referencia;
  - registrarlo otra vez da 409.
- **Idempotencia:** si la pasarela ya lo había reembolsado (`reembolso_ref` guardado), no se le vuelve a pedir: se reutiliza la referencia.
- **`PAGO_REEMBOLSADO` con éxito** necesita claves sandbox: Stripe y PayPal tienen la URL fija y no hay cómo simularlos sin cambiar el código. Queda documentado.

**Reseñas (`RESENA_PUBLICADA`)**

- Rechazos: quien no compró recibe 403, el personal también (403), una calificación de 7 da 422 y un XSS da 400.
- Quien compró publica (201) y el evento guarda el producto y la calificación.
- La reseña no aparece en la tienda hasta moderarla. Un cliente no puede moderar (403); el admin la aprueba y entonces aparece.

**`PRODUCTO_ACTUALIZADO`**

- Por la moderación: guarda `visible` antes y después.
- Por la edición: un cliente no puede editar productos (403). Al marcar como destacado el producto de CP-47, el evento guarda 0 → 1.
- Al final se deja todo como estaba: la reseña oculta y el producto sin destacar.

### 2. CP-51 · Reprogramar, horarios del equipo y correcciones del historial

- **`CITA_REPROGRAMADA`:**
  - otro cliente no puede reprogramar la cita (404) y al mismo día y hora da 422;
  - el dueño la reprograma (200) y el evento guarda el horario anterior, el nuevo y quién la movió;
  - `historial_citas` dice «Reprogramada de … a … por el cliente».
- **`PROFESIONAL_ACTUALIZADO`:**
  - un cliente no puede cambiar horarios (403);
  - quitarle al profesional el día de una cita ya agendada da 409;
  - un XSS en el nombre da 400;
  - guardar sin cambios da 200, y el evento guarda el horario anterior y el nuevo.
  - La cita de prueba se cancela al final.
- **`HISTORIAL_CORREGIDO`:**
  - rechazos: un cliente recibe 403, una consulta inexistente 404 y un XSS 400;
  - la adenda se agrega y la ficha original no cambia;
  - el evento guarda la consulta, la mascota y quién corrigió, sin el texto de la corrección.

### 3. Error encontrado y corregido: reprogramar al mismo horario

Si el turno estaba lleno por la misma cita (por ejemplo, el último lugar), reprogramar al mismo día y hora respondía **409 «Ese turno se acaba de llenar. Elige otro»**. Ese mensaje es engañoso: el cliente eligió el horario que ya tenía. Pasaba porque la comprobación de disponibilidad iba antes que la de «mismo horario».

- **Corrección** (`CitasController::reprogramar()`): en los servicios por turnos, la comparación con el horario actual va antes de mirar la disponibilidad → **422 «Elige un día u hora distintos»**.
- **Comprobación a mano:** se llenó un turno con dos citas, se reprogramó una al mismo horario y respondió 422. Las citas de prueba se cancelaron.

### 4. Resultado

**342 pasaron, 0 fallaron** (51 casos). Los 38 eventos de la bitácora tienen prueba automática. `PAGO_REEMBOLSADO` con éxito necesita claves.

### 5. Documentación

- `docs/02-owasp-top10.md`: en el catálogo A09, los ocho eventos tienen ahora su prueba (CP-50 o CP-51).
- `docs/01-arquitectura-stride-dfd.md`: las tres filas 🟡 pasan a ✅ (CP-50 y CP-51).
- `docs/06`, `docs/08`, `README.md` y `falta.md`: los conteos nuevos.

Commit: `e4b727f`.

## 2026-10-29 · Revisión en el navegador

### 1. Cómo se hizo

Con Chromium sin interfaz (`playwright-core` 1.46.1, fuera del repositorio). La sesión de cada rol se inyectó igual que la guarda el frontend: el token en `sessionStorage`.

**Pantallas revisadas:**

| Rol | Pantallas |
|---|---|
| Cliente | reservar, mis citas, mis mascotas, mis pedidos, detalle de pedido, producto con reseñas, checkout con carrito, seguridad |
| Admin | hoy, agenda (por hora, por consultorio y en un día con 24 citas), pacientes, paciente, clientes, cliente, pedidos, pedido, catálogo, bitácora |
| Veterinario, recepción y tienda | sus secciones, y una sección de otro rol abierta por URL |
| Cliente creado desde el panel | la ventana de contraseña obligatoria |

**En cada pantalla**, en escritorio (1366 px) y en celular (390 px):
- se guardó una captura;
- se registraron los errores de JS, los errores de consola y las peticiones que respondieron 4xx o 5xx;
- se buscó desborde horizontal;
- en los casos dudosos se midió en el navegador, también a 360 y 430 px.

### 2. Qué se encontró y se corrigió

1. **El encabezado no cabía en celulares.**
   - **Causa:** logo con nombre (164 px) + 3 iconos + «Reservar» + ☰ suman 469 px, y en un teléfono de 390 hay 358 px.
   - **Efecto:** el navegador ensanchaba toda la página a 485 px, así que:
     - el botón ☰ quedaba fuera de la pantalla y no se podía abrir el menú;
     - «Reservar» se veía cortado;
     - la ventana de **contraseña obligatoria** quedaba cortada a la derecha (440 px de ancho en 390).
   - Sin el botón «Reservar» del encabezado (agregado en `49605a7`) tampoco cabía: 370 px.
   - **Corrección** (`Brand.jsx`, `shop.css`): hasta 480 px, el logo muestra solo la huella (el nombre queda oculto a la vista, y el enlace se anuncia como «Inicio») y los espacios bajan a 12 y 6 px.
   - **Resultado:** a 360, 390 y 430 px el ancho de la página es igual al de la pantalla, el ☰ abre el menú y la ventana mide 358 px.
2. **Dos tablas sin desplazamiento propio:** «Personal» (solo admin, en Clientes) y «Pedidos» del detalle de un cliente. Ensanchaban la página en celular, así que se envolvieron en `.table-scroll`, como el resto del panel.
3. **La tienda pedía datos que no le corresponden.**
   - En Clientes, el panel llamaba a `/api/citas/admin/clientes/contadores` aunque la tienda no tiene acceso a citas: un 403 en la consola y tres columnas llenas de «—».
   - Ahora solo lo pide el personal de la clínica, y la tienda no ve esas columnas.
4. **Sección de otro rol abierta por URL** (por ejemplo, la tienda en `/admin/agenda`).
   - **Antes:** se veía la agenda con sus formularios, dos «No tienes permiso» y un «Cargando…» que no terminaba.
   - **Ahora:** `AdminLayout` revisa la sección contra el rol y muestra «Agenda no es parte de tu rol» con un botón a Hoy. El servidor igual responde 403 a cada dato.
5. **La fila de fecha de la agenda** se salía 8 px de la tarjeta en celular: ahora se acomoda en dos líneas (`flex-wrap`).

### 3. Comprobado además

- **Cambio de contraseña obligatorio hecho en la pantalla**, como un cliente:
  - con contraseñas distintas avisa «no coinciden»;
  - al guardar, la ventana se cierra y no vuelve al recargar;
  - la contraseña nueva sirve para entrar.
- **Reservar:** el selector «¿Con quién? (opcional)» ofrece los profesionales.
- **Agenda «Por consultorio»:** una columna por profesional; en celular, la tabla se desplaza dentro de la tarjeta.
- **Checkout sin claves:** avisa que el pago en línea no está disponible y que el pedido se aparta.

### 4. Resultado final

- **74 de 74 pantallas** sin errores de JS, sin peticiones fallidas y sin desborde.
- `tests/seguridad.sh`: **342 pasaron, 0 fallaron**.

### 5. Pendiente

- Probar en un teléfono real, y en Safari/iOS.
- Detalle menor sin corregir: en `/reservar`, en celular, el precio se corta dentro del selector de servicio.
- Los nombres con números («Firulais 6588113») son datos que dejan las pruebas en la base local.

Commit: `cf104da`.

## 2026-10-29 · Panel con `lazy()`

### 1. Cambio

- **`App.jsx`:** las 11 páginas del panel (`AdminLayout`, `AdminResumen`, `AdminAgenda`, `AdminPacientes`, `AdminPaciente`, `AdminPedidos`, `AdminPedido`, `AdminCatalogo`, `AdminBitacora`, `AdminClientes`, `AdminCliente`) se cargan con `lazy()`. Antes solo `AdminResumen`, por Chart.js. La ruta `/admin` lleva su `Suspense`.
- **`AdminLayout.jsx`:** un `Suspense` alrededor de la sección. El encabezado, las pestañas y el control de rol quedan fijos mientras baja la sección.
- Ninguna página pública importa del panel (se comprobó con `grep`), así que nada del panel se cuela en el bundle de la tienda.

### 2. Medido

| | Antes | Después |
|---|---|---|
| Bundle principal (`index-*.js`) | 540 KB (gzip 159) | 377 KB (gzip 115) |
| Aviso de Vite «chunks > 500 kB» | sí | no |
| JS que descarga `/tienda`, `/reservar` o `/cuenta/citas` | 540 KB | 421 KB (3 archivos, nada del panel) |
| `/admin` (Hoy) | — | 580 KB (incluye Chart.js) |
| `/admin/agenda` | — | 476 KB (sin Chart.js) |

Los 421 KB de la tienda son el bundle principal más dos piezas compartidas que Rolldown separó: los iconos (`createLucideIcon`, 43 KB) y `Loading` (11 KB).

### 3. Comprobado

- Revisión en el navegador: **74 de 74** pantallas sin errores, sin peticiones fallidas y sin desborde.
- Navegación por las pestañas del panel con clics, cargando cada sección al momento: todas muestran su contenido. Volver con «atrás» desde la tienda también funciona.
- `oxlint` sin avisos; la CSP no cambia, porque los trozos son del mismo origen (`script-src 'self'`).

Commit: `f99bb97`.

## 2026-10-29 · PDF SEC-1 regenerado

### 1. Cómo se generó

```bash
npm i --no-save --no-package-lock playwright-core@1.46.1 marked@12   # en la raíz del repo
node docs/pdf/construir.mjs ~/.cache/ms-playwright/chromium-1140/chrome-linux/chrome
rm -rf node_modules
```

- Junta `docs/01` a `docs/06`, `docs/zap/README.md` y el último simulacro (`docs/simulacros/20261017-1126-ransomware-maestro.md`).
- Los diagramas los dibuja Mermaid 10.9.1 desde el CDN, así que hace falta internet.

### 2. Comprobado

| | Antes | Después |
|---|---|---|
| Páginas | 24 | 27 |
| Tamaño | 504 KB | 572 KB |

- **El texto del PDF trae lo de hoy:**
  - «A09 — Catálogo de eventos de la bitácora» (pág. 13) y «A01 en los roles del personal»;
  - CP-49 a CP-51, `ROL_CAMBIADO`, `HISTORIAL_CORREGIDO`, `PAGO_REEMBOLSADO`, `TipoCambio`, `Guard::VETERINARIO`;
  - 38 tipos de evento y «342 comprobaciones en 51 casos».
- **No queda nada viejo:** ni «27 tipos» ni «263 comprobaciones».
- **Los 5 diagramas Mermaid salieron como dibujo:** ninguno quedó como código. Se revisaron las imágenes de las páginas 4 (DFD) y 13 (catálogo).

### 3. Cuándo volver a generarlo

- si cambian los docs 01 a 06;
- después del ZAP contra el dominio, con su informe;
- si se corre un simulacro DRP nuevo.

## Siguiente

- Pendientes del equipo: claves sandbox, fotos reales, textos del negocio, prueba en un teléfono real.

## 2026-10-29 · Push y decisión sobre el ENUM de `rol`

- **Push** a `origin/main` (github.com/AxER1402/Veterinaria) de los 7 commits del día, de `cb3bf3f` a `1fe9618`. Antes se hizo `git fetch`: no había cambios nuevos del equipo, así que no hubo merge.
- **Decisión del usuario:** el `rol` de la bitácora **se mantiene ampliado** (`veterinario`, `recepcion`, `tienda`).
  - El enunciado define `ENUM(admin,cliente,anonimo)`, y los tres valores originales siguen igual.
  - Motivo: registrar a todo el personal como `admin` ocultaría quién hizo qué (R de STRIDE) y negaría el mínimo privilegio (A.5.15).
  - La justificación para la presentación está en `docs/08-guion-presentacion.md`.
  - No se cambia código.

- **CI:**
  - Las dos corridas anteriores en `main` (`c7de3f3` y la previa) estaban en **rojo** por el falso positivo de CP-28 (`frecuencia_cardiaca`): 273 pasaron y 1 falló. Se corrigió esta mañana en `cb3bf3f`.
  - Con el push, la corrida 40873345520 quedó **en verde** en sus 4 trabajos: SAST, frontend, PHP y secretos, y stack completo con pruebas de seguridad y simulacro DRP.

## 2026-10-29 · Bases vacías en macOS

### 1. Causa (reproducida)

El entrypoint de MariaDB **ejecuta** los `.sh` de `/docker-entrypoint-initdb.d` que tienen bit de ejecución, y **carga con `source`** los que no. `db/master/01-bases-y-usuarios.sh` y `db/audit/01-audit_db.sh` deben cargarse con `source`, porque usan `docker_process_sql`. En macOS, el bind mount de Docker Desktop puede mostrarlos como ejecutables.

Se reprodujo en Linux con `chmod +x`, en una copia aparte (proyecto `huellitasmac` con volúmenes propios, sin tocar la base de desarrollo):
- error `docker_process_sql: command not found`;
- **ninguna de las 5 bases se creó**;
- el contenedor igual quedó **healthy**: falla en silencio y la demo no arranca.

### 2. Corrección

- **`db/iniciar-mariadb.sh`** (nuevo): copia los scripts montados en `/huellitas-initdb` a `/docker-entrypoint-initdb.d` con permisos 644 y luego llama al entrypoint normal de MariaDB. Se corre con `sh`, así que solo necesita permiso de lectura.
- **`docker-compose.yml`:**
  - `mariadb-master` y `mariadb-audit` montan `./db/master` o `./db/audit` en `/huellitas-initdb` y usan ese entrypoint;
  - `mariadb-audit` declara `command: ["mariadbd"]`, porque al cambiar el entrypoint Compose ya no usa el CMD de la imagen.
- **`.gitattributes`** (nuevo): LF en `.sh`, `.sql`, `Dockerfile`, `.conf` y `.template`. Un `.sh` con CRLF también rompería el arranque, por ejemplo al clonar en Windows. Se comprobó con `git add --renormalize`: no cambia ningún archivo actual.

### 3. Comprobado

- **En la copia aparte, con los scripts aún ejecutables y volúmenes nuevos:** se crean las 5 bases, los 5 usuarios por servicio, el catálogo (40 presentaciones), `audit_db` y sus 2 triggers append-only. Después se borró con `down -v` (0 volúmenes `huellitasmac` restantes).
- **En el stack de desarrollo:** los 14 contenedores quedan healthy y `tests/seguridad.sh` da **342 pasaron, 0 fallaron**.
- **Pendiente:** confirmarlo en una Mac real.

Commit: `9afc4c7`.

## 2026-10-29 · Base local limpia para la demo

### 1. Pasos

1. **Respaldo** con `ops/backup.sh` → `backups/20261029-071659`. Se verificó: `sha256sum -c` correcto y se descifra.
2. `docker compose down` (sin `-v`). Se borraron **solo** `huellitas_master_data`, `huellitas_slave_data` y `huellitas_redis_data`, comprobando antes que fueran del proyecto `huellitas`.
   - Redis también, porque guarda la caché del catálogo y los contadores con los IDs y precios viejos.
   - **La bitácora (`huellitas_audit_data`) se conservó:** es append-only, encadenada y es la evidencia de SEC-2. Borrarla contradiría la retención que dicen los docs.
3. `docker compose up -d --wait`: los scripts de inicio crean todo, ya en quetzales. Los 14 contenedores quedaron healthy.
4. `ops/seed-demo.sh` (`db/seeds/01-demo.sql` y `02-resenas.sql`).

### 2. Antes y después

| | Antes | Después |
|---|---|---|
| Usuarios | 167 | 12 |
| Mascotas | 105 | 13 |
| Citas | 250 | 42 |
| Pedidos | 209 | 13 |
| Productos | 32 | 24 |
| Reseñas | — | 14 |

Precio máximo Q695; la moneda por defecto de los pagos es `GTQ`.

### 3. Comprobado

- **Réplica al día:** IO y SQL en `Yes`, retraso 0 y las mismas 42 citas.
- **Cuentas:** las 5 de `usuarios.md` (admin, veterinaria, recepción, tienda y cliente) y los 7 clientes de demo (`Cliente#2026`) inician sesión (200).
- **Revisión en el navegador:** **72 de 72** pantallas sin errores, sin peticiones fallidas y sin desborde. Se omitió el rol con contraseña temporal para no crear datos.
- **La agenda de hoy muestra la demo:** Kiara (guardería, atendida), Luna (peluquería, confirmada) y Max (consulta con la Dra. Andrea Morales, pendiente). Ningún nombre de prueba.

### 4. Ojo para la presentación

`tests/seguridad.sh` crea datos de prueba: clientes «compras…», mascotas «Firulais 123…» y citas en los próximos 40 días. El guion (`docs/08`) lo corre en «Antes de empezar». Hay dos opciones:
- correrlo en vivo y aceptar esas filas en la agenda y en Clientes;
- mostrar la última corrida del CI en verde y dejar la base limpia.

Commit: `cf26980`. Push de `9afc4c7` y `cf26980`: el CI 40883787130, que levanta todo desde cero, quedó **en verde**. Eso confirma también el arranque nuevo de las bases.

## 2026-10-29 · Guion de la presentación con el CI como evidencia

Decisión del usuario: en la presentación **no** se corre `tests/seguridad.sh` contra la base de la demo. Se muestra la última corrida del CI en verde.

### 1. `docs/08-guion-presentacion.md`

- **«Antes de empezar»:** `gh run list --repo AxER1402/Veterinaria --workflow CI --limit 1` en vez de correr la suite, con el aviso de por qué no correrla contra la demo. Se agrega una pestaña 3 con la corrida del CI.
- **Min 2:15 (pago sin claves):** ahora usa `ops/demo-pago-sin-claves.sh <id>` en vez de la suite.
- **Min 5:00:** decía «27 tipos de evento: 14 + 13»; ahora dice **38: 14 + 24**, cada uno con su prueba.
- **Min 8:45:** «CI, ZAP, ALE/ROSI y cierre», mostrando el CI en verde (342 comprobaciones en 51 casos).
- **Ataque 2 (precio manipulado):** esperaba `19.99` (precio en dólares); ahora `jq .totales.total` → **155**, el precio real en quetzales.

### 2. `ops/demo-pago-sin-claves.sh` (nuevo)

- Paga un pedido `pendiente_pago` como lo haría Stripe:
  - deja la fila del pago en `pagos_db` (lo que habría creado el inicio del pago);
  - envía `payment_intent.succeeded` tres veces: sin firma (400), con firma falsa (400) y firmado con `STRIPE_WEBHOOK_SECRET` (200).
- Valida que el id sea un UUID y que el pedido esté pendiente de pago.
- **Probado en un stack completo aparte** (proyecto `huellitasmac`, puertos 8089 y 8444, volúmenes propios):
  - el pedido pasó a `pagado` y el cliente lo vio así;
  - la bitácora registró `WEBHOOK_STRIPE_RECIBIDO` con FALLO, FRAUDE y EXITO, más `PAGO_CONFIRMADO` y `PEDIDO_ESTADO_CAMBIADO`;
  - pagar otra vez el mismo pedido se rechaza;
  - un id inválido se rechaza.
- **La base de la demo quedó intacta:** 0 pagos `pi_demo_` y los mismos 13 pedidos.

**Trampas al probar en una copia:** `docker-compose.yml` fija `name: huellitas`, así que en una copia hay que usar `COMPOSE_PROJECT_NAME=<otro>` (la variable tiene prioridad). Y `down --rmi local` borra las etiquetas `huellitas/*:latest`, que comparte con el stack de desarrollo. Se restauraron con `docker compose build`, y los 14 contenedores siguieron healthy.

### 3. CI con resumen

`.github/workflows/ci.yml`:
- el paso de pruebas guarda la salida con `tee`; con `shell: bash` corre con `pipefail`, así que un fallo no queda tapado;
- un paso nuevo, `if: always()`, publica en la página de la corrida el resultado («Resultado: N pasaron, M fallaron») y cada `✘`.


## 2026-10-29 · Reservar en celular, adjuntos del historial y contraseñas root

### 1. `/reservar` en celular (390 px)

- **Causa:** `.booking__steps` y `.booking__login` eran grids sin columnas definidas, así que la columna tomaba el ancho mínimo del contenido más largo (el texto de la opción y el botón con `nowrap`). La tarjeta quedaba 33 px más ancha que la pantalla: el precio del selector se cortaba («desde Q 2…»), la cuarta columna de horas quedaba tapada y el texto del paso 4 y el botón se salían. No se notaba como desplazamiento lateral porque `body` tiene `overflow-x: hidden`.
- **Cambios:**
  - `shop.css`: `.booking__steps` y `.booking__login` con `grid-template-columns: minmax(0, 1fr)`; el botón del paso 4 puede partirse en dos líneas.
  - `index.css`: `.form-grid` usa `minmax(0, 1fr)` y `.field` tiene `min-width: 0`, para que ningún selector con texto largo ensanche un formulario.
  - `BookingForm.jsx`: la opción muestra solo el nombre del servicio; el precio pasa a la línea de la sede («Desde **Q 250.00**. Se atiende en…»).
- **Comprobado** en Chromium a 390 px, sin sesión y con la cuenta del cliente: el documento mide 390 px, las horas se ven en 3 columnas y el formulario del paso 4 cabe completo.

### 2. Adjuntos del historial (probado de punta a punta)

Sin cambios de código. Con la cuenta `veterinaria@huellitas.gt`, desde la ficha de un paciente, en el navegador:
- se subieron un PDF (laboratorio) y un PNG (radiografía): Cloudinary los aceptó con la firma de `citas-service`, la API los registró (201) y aparecen en la ficha; sin errores de JS ni bloqueos de la CSP;
- el enlace firmado devuelve el archivo idéntico y vence a los 600 s;
- con la firma alterada, con un enlace vencido o con la URL sin firma (`private`), Cloudinary responde 401; como si fuera pública (`upload`), 404;
- cliente, recepción y tienda reciben 403 al pedir la firma de subida; sin sesión, 401.

Al terminar se borraron los dos archivos de Cloudinary (`destroy`) y sus filas de `historial_adjuntos`. Quedan en la bitácora los dos `HISTORIAL_REGISTRADO`.

### 3. Contraseñas root de la base local

- Se cambiaron `DB_ROOT_PASSWORD` (master y réplica) y `AUDIT_DB_ROOT_PASSWORD`, porque una se mostró en una sesión de trabajo. Respaldo previo: `backups/20261029-231956`.
- `ALTER USER` en el master (la réplica lo recibe por replicación) y en la base de auditoría; `.env` actualizado y con permisos 600; los tres contenedores de base recreados para que su entorno no guarde la contraseña vieja.
- Comprobado: la contraseña vieja da «Access denied» en las tres; la réplica sigue al día (IO y SQL en `Yes`, 0 s de retraso); la app y `ops/evidencia.sh` funcionan.
- Los respaldos no cambian: se cifran con `BACKUP_PASSPHRASE`. Los healthchecks usan su propio usuario. El servidor no se tocó.

## 2026-10-29 · Páginas de Privacidad y Términos

- **Nuevas rutas:** `/privacidad` y `/terminos`. Los enlaces del pie de página ya no apuntan a `#`. Ambas páginas usan una plantilla común (`components/LegalPage.jsx`): encabezado, fecha de actualización, texto en una columna de 760 px y el contacto al final. Los estilos `.legal*` están en `index.css`.
- **Privacidad** (`pages/Privacidad.jsx`) describe lo que el sistema hace de verdad:
  - qué datos guarda y para qué;
  - quién puede ver cada dato según el rol (el historial solo lo ven veterinarios y administración, y cada lectura se audita);
  - los servicios externos: Stripe, PayPal, Cloudinary (archivos clínicos privados con enlace de 10 min), EmailJS, Google Maps y Cloudflare R2;
  - cuánto tiempo se guardan: respaldos 30 días, bitácora 2 años inmodificable;
  - qué guarda el navegador: sesión en `sessionStorage`, carrito y favoritos en `localStorage`, sin cookies de seguimiento;
  - los derechos del cliente (ver y corregir en Mi cuenta; copia o borrado por correo).
- **Términos** (`pages/Terminos.jsx`) recoge las reglas del código:
  - citas (`CitasController`): lunes a sábado de 8:00 a 20:00, hasta 60 días antes y al menos 1 h antes; 3 citas activas por mascota y 10 por cuenta; cambiar o cancelar hasta 2 h antes; 3 faltas en 90 días obligan a agendar por teléfono; hospedaje de 30 noches como máximo;
  - pedidos: envío de Q35, gratis desde Q400 después de descuentos, y retiro en sede gratis (`Totales.php`); un pedido sin pagar se cancela a las 2 h (`PEDIDO_VENCE_HORAS`) y el cliente solo puede cancelarlo mientras está pendiente de pago;
  - cupones: uno por pedido, con vencimiento o marca;
  - PayPal cobra en dólares con el tipo de cambio del Banguat;
  - solo opina quien compró el producto;
  - cambios y devoluciones: según la Ley de Protección al Consumidor y Usuario (Decreto 006-2003).
- **No se inventaron políticas del negocio:** no se fija un plazo de devolución ni exclusiones. Queda pendiente en `falta.md`.
- **Comprobado** en Chromium a 390 px y 1366 px: los enlaces del pie de página llevan a cada página, que abre arriba, sin desborde horizontal ni errores de JS. `npm run lint` sin avisos.
