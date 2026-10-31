# Huellitas — Controles OWASP Top 10 (2021)

Cada control indica **dónde está en el código** y **qué caso de `tests/seguridad.sh` lo comprueba**.
Estado al cierre de la semana 3: los 7 controles (A01, A02, A03, A05, A07, A08 y A09) implementados. En la FASE 15 se aplicaron los mismos controles al módulo de citas (`citas-service`), con las pruebas CP-37 a CP-46. Después se agregaron los roles del personal (`veterinario`, `recepcion`, `tienda`), probados en CP-49, y la bitácora pasó a 38 tipos de evento ([catálogo al final](#a09--catálogo-de-eventos-de-la-bitácora)).

| ID | Amenaza | Control | Código | Prueba |
|---|---|---|---|---|
| A01 | Broken Access Control | `id_cliente` del JWT en cada consulta de pedidos, mascotas, citas y carné; 404 idéntico para "no existe" y "es de otro"; rutas del panel por rol (`Guard::CLINICA`, `VETERINARIO`, `TIENDA`; usuarios, roles, bitácora y exportación solo `admin`) | `services/pedidos/src/PedidosController.php` (`misPedidos`, `ver`), `services/citas/src/CitasController.php` (`mascotaPropia`, `citaPropia`), `services/shared/src/Guard.php` | CP-07, CP-20, CP-37, CP-40, CP-45, CP-49 |
| A02 | Cryptographic Failures | bcrypt cost 12; solo TLS 1.3 + HSTS; sin datos de tarjeta en ninguna BD; JWT HS256 con secretos de 48 caracteres en `.env` | `services/auth/src/AuthController.php` (`BCRYPT`), `gateway/default.conf.template` (`ssl_protocols`), `db/master/*.sql` | CP-01, CP-02, CP-05 |
| A03 | Injection | PDO sin emulación de prepared statements; validación de tipo y rango; WAF en Nginx (URL, cabeceras) y en PHP (cuerpo JSON, también en mascotas, citas y diagnósticos) | `services/shared/src/Db.php`, `services/shared/src/Validar.php`, `gateway/default.conf.template` (`map $waf_*`) | CP-10, CP-24, CP-37, CP-44 |
| A05 | Security Misconfiguration | Secretos solo en `.env`; BD y Redis sin puertos publicados; contenedores PHP como `www-data`, `read_only`, `cap_drop: ALL`; sin versiones en cabeceras; errores genéricos | `docker-compose.yml`, `services/Dockerfile`, `services/shared/src/Router.php` | CP-03, CP-14 |
| A07 | Identification & Authentication Failures | 5 intentos → bloqueo 15 min; rate limit en `/login`; JWT de 1 h; logout → lista negra Redis; mismo mensaje y mismo tiempo exista o no el correo; **verificación en dos pasos TOTP** (secreto cifrado AES-256-GCM, desafío de 5 min y un solo uso, códigos no reutilizables, los códigos fallidos cuentan para el bloqueo) | `AuthController::login()`, `verificarMfa()`, `Totp.php`, `Cache::revocar()`, `zone=login` | CP-05, CP-08, CP-09, CP-16, CP-34 |
| A08 | Software & Data Integrity Failures | Firma `Stripe-Signature` del webhook (HMAC, tolerancia 5 min, idempotencia) y verificación de monto; cadena de hashes en la bitácora; dependencias fijadas con `package-lock.json` | `services/pagos/src/Stripe.php::firmaValida()`, `AuditController::integridad()` | CP-12, CP-26, CP-27 |
| A09 | Security Logging & Monitoring Failures | `security-audit-service` con eventos append-only; cada servicio reporta solo los suyos (38 tipos: los 14 obligatorios y 24 extra, 13 de ellos del módulo de citas; ver el catálogo al final) | `services/audit/src/AuditController.php`, `services/shared/src/Auditoria.php` | CP-12, CP-13, CP-40, CP-46, CP-49 |

---

## A01 — Broken Access Control

**Riesgo en el e-commerce:** un cliente cambia el ID de la URL (`/api/pedidos/…`) y ve la dirección, el teléfono y la compra de otra persona. Otro riesgo es un cliente que llama a rutas de administración.

**Controles:**

1. **El filtro sale del token, nunca de un parámetro.** `misPedidos()` hace `WHERE p.id_cliente = ?` con `$claims['sub']`, el ID que viene dentro del JWT firmado. El cliente no tiene forma de pedir los pedidos de otro.
2. **Detalle de un pedido.** `ver()` busca primero el dueño. Si no coincide con el `sub` del token y el rol no es admin, responde **404**, igual que si el pedido no existiera, para no confirmar que existe. Además registra `ACCESO_DENEGADO` en la bitácora, lo que permite detectar a alguien probando IDs.
3. **IDs no adivinables.** Los pedidos usan UUID v4 (`Jwt::uuid()`, 122 bits aleatorios), no enteros consecutivos.
4. **Rutas administrativas por rol.** Cada ruta del panel pide el rol que corresponde a ese trabajo (ver [Roles del personal](#a01-en-los-roles-del-personal)). El rol viene del token firmado, y el registro público siempre crea `cliente` aunque el cuerpo diga `"rol":"admin"`.
5. **Servicio a servicio.** `/internal/*` no se publica en el gateway, y cada ruta interna acepta solo a ciertos servicios. Por ejemplo, solo `pedidos-service` puede reservar stock.

```php
// services/pedidos/src/PedidosController.php — misPedidos()
$consulta = Db::lectura()->prepare(self::SQL_RESUMEN . ' WHERE p.id_cliente = ? GROUP BY p.id ORDER BY p.fecha DESC LIMIT 100');
$consulta->execute([(int) $claims['sub']]);
```

**Evidencia:** CP-20. El cliente B pide el pedido del cliente A y recibe 404, y la bitácora registra `ACCESO_DENEGADO` con el ID del pedido y el correo de B.

### A01 en el módulo de citas

Las mascotas, las citas y el carné de vacunas siguen la misma regla que los pedidos:

- **Dueño desde el token.** `misCitas()` y `mascotas()` filtran por `id_cliente = sub`. `mascotaPropia()` y `citaPropia()` responden 404 si el recurso es de otro cliente y registran `ACCESO_DENEGADO` con el recurso (`mascota`, `cita` o `carné de vacunas`).
- **No se reserva con la mascota de otro.** `crear()` valida la mascota con `mascotaPropia()` antes de tocar la agenda.
- **Rutas del personal.** La agenda, el cambio de estado y los bloqueos de turnos están bajo `/api/citas/admin/*` y exigen `Guard::CLINICA` (admin, veterinario o recepción). El historial clínico exige `Guard::VETERINARIO` (admin o veterinario): es dato de salud, y cada lectura queda como `HISTORIAL_CONSULTADO`. Una corrección no cambia la ficha original: se agrega una adenda visible y queda `HISTORIAL_CORREGIDO`.
- **Solo transiciones válidas.** El estado de una cita solo avanza según la tabla `TRANSICIONES` (`pendiente → confirmada → atendida`, `no_asistio` o `cancelada`). Un estado final no se puede cambiar.

**Evidencia:** CP-37 (editar una mascota ajena → 404 + `ACCESO_DENEGADO`), CP-38 (reservar con la mascota de otro → 404), CP-40 (un cliente no ve la agenda ni cambia estados → 403) y CP-45 (carné ajeno → 404; historial clínico desde una cuenta de cliente → 403).

### A01 en los roles del personal

**Riesgo:** con un solo rol `admin`, la recepcionista podía leer diagnósticos y la persona de la tienda podía exportar todos los clientes o cambiar roles. Cada cuenta del personal tenía todos los permisos.

**Controles (`services/shared/src/Guard.php`):**

| Grupo | Roles | Qué abre |
|---|---|---|
| `Guard::PERSONAL` | admin, veterinario, recepcion, tienda | Entrar al panel (`ACCESO_ADMIN_PANEL`) y buscar clientes |
| `Guard::CLINICA` | admin, veterinario, recepcion | Agenda, citas, bloqueos de turnos, pacientes, alta de clientes |
| `Guard::VETERINARIO` | admin, veterinario | Historial clínico, adendas, adjuntos, vacunas |
| `Guard::TIENDA` | admin, tienda | Pedidos, reembolsos, catálogo, reseñas, clima |
| `['admin']` | admin | Bitácora, exportación de clientes, personal, cambio de roles y horarios del equipo |

1. **Mínimo privilegio.** Cada ruta pide el grupo que corresponde a ese trabajo. Por ejemplo, recepción agenda citas pero no ve diagnósticos, y la tienda gestiona pedidos pero no ve la agenda.
2. **Solo el admin asigna roles** (`PATCH /api/auth/admin/usuarios/{id}/rol`). Nadie puede cambiar su propio rol (409), y un rol fuera de la lista se rechaza (422). Cada cambio queda como `ROL_CAMBIADO`, con el rol anterior, el nuevo y quién lo hizo.
3. **El rol rige con el siguiente token.** El rol va firmado en el JWT, que dura como máximo 1 h. Un cambio de rol se aplica al iniciar sesión otra vez.
4. **Contraseña temporal.** Cuando el personal da de alta a un cliente en el panel, el sistema genera una contraseña temporal y obliga a cambiarla en el primer ingreso. El cambio pide la contraseña actual y queda como `PASSWORD_CAMBIADO`, sin la contraseña en la bitácora.
5. **La bitácora acepta los roles nuevos** (`db/audit/02-roles-personal.sql`): solo se amplió el ENUM `rol`, sin tocar los registros ni la cadena de hashes.

**Evidencia:** CP-49. Un usuario de prueba pasa por cada rol del personal, y en cada uno se comprueba que llega a las rutas de su trabajo y recibe 403 en las demás. También se comprueban el 403 al cambiar roles sin ser admin, el 409 al cambiar el propio, el registro de `ROL_CAMBIADO` y el cambio de contraseña con `PASSWORD_CAMBIADO`.

---

## A02 — Cryptographic Failures

| Dato | Protección |
|---|---|
| Contraseñas | `password_hash(..., PASSWORD_BCRYPT, ['cost' => 12])`. Si en el futuro sube el costo, `password_needs_rehash` actualiza el hash en el siguiente login |
| Tránsito | Gateway con `ssl_protocols TLSv1.3` únicamente, HSTS de 1 año y HTTP → 301 a HTTPS |
| Tarjetas | **Ninguna tabla tiene columnas de tarjeta.** El navegador envía la tarjeta directo a Stripe.js / PayPal (semana 3) y Huellitas guarda solo `payment_intent_id` |
| Tokens | JWT HS256 con `JWT_SECRET` para usuarios y otro secreto distinto (`SERVICE_JWT_SECRET`) entre servicios. La firma se compara con `hash_equals` |
| Bitácora | Cadena SHA-256: cada fila incluye el hash de la anterior |
| Secretos | Solo en `.env` (permisos 600, en `.gitignore`). `.env.example` trae las claves vacías |

---

## A03 — Injection

**Capa 1: consultas parametrizadas.** Todas las consultas pasan por `PDO::prepare` con `PDO::ATTR_EMULATE_PREPARES => false`, así que el motor recibe la consulta y los datos por separado. Hay dos casos donde se arma texto SQL, y en ninguno entra texto del usuario:
- Los nombres de columna en `UPDATE … SET` salen de una lista fija del código (`actualizarVariante`, `actualizarProducto`).
- Los `IN (?, ?, …)` se arman solo con el número de signos `?`.

**Capa 2: validación de tipo y rango.**
- `variante_id` y `cantidad` deben ser enteros JSON. La cantidad va de 1 a 99 y el carrito tiene como máximo 30 líneas.
- Los precios son números positivos con hasta 2 decimales.
- Teléfono, cupón y UUID se validan con expresiones regulares.
- Los textos se recortan, se les quitan las etiquetas y se limita su longitud.

**Capa 3: WAF.**
- Nginx bloquea con 403 las firmas conocidas en la URL, el user-agent, el referer y las cookies: `UNION SELECT`, `' OR 1=1`, `<script`, `../`, `sleep(`, `sqlmap`…
- Nginx no inspecciona el cuerpo, así que `Validar::sinAtaques()` revisa todos los textos del JSON salvo las contraseñas.

**Evidencia:** CP-10 y CP-24. `x'; DROP TABLE pedidos; --` en la dirección da 400, `<img onerror>` en las notas da 400 y `"1 OR 1=1"` como ID de variante también se rechaza.

---

## Manipulación de precios (T de STRIDE, relacionado con A04 Insecure Design)

El navegador manda **solo** `variante_id` y `cantidad`. `pedidos-service` descarta cualquier otro campo (`precio`, `subtotal`, `total`) antes de llamar a `catalogo-service`. El catálogo devuelve el precio vigente desde el **maestro** (no la réplica, para no usar un precio desactualizado) y `Totales::calcular()` hace las cuentas en centavos enteros. El cupón se valida en la BD y el envío se decide en el servidor.

**Evidencia:** CP-18. Se envía `"precio": 0.01, "total": 0.02` y el pedido queda con el precio real del catálogo.

---

## Doble reserva y acaparamiento de la agenda (A04 Insecure Design)

**Riesgo:** dos clientes reservan el último cupo al mismo tiempo y los dos reciben la cita, o un cliente reserva todos los turnos de una sede.

**Controles (`CitasController::crear()`, `db/master/07-citas_db.sql`):**

1. **El índice único decide, no el código.** La tabla `citas` tiene `UNIQUE (sede, inicio, cupo)`. La reserva prueba el cupo 1 y luego el 2 dentro de una transacción; si los dos ya están ocupados, el motor rechaza el INSERT y el cliente recibe 409. Leer la disponibilidad antes de reservar no basta, porque dos peticiones pueden leer «1 libre» a la vez.
2. **Una mascota, una cita por hora:** `UNIQUE (mascota_id, inicio)`.
3. **Bloqueos sin carreras.** `bloquear()` toma el rango con `SELECT … FOR UPDATE`. Una reserva que llega mientras tanto espera, vuelve a leer los bloqueos y se deshace si el turno quedó bloqueado.
4. **Límite por cliente:** máximo 5 citas próximas, reservas hasta 60 días adelante y al menos 1 h antes del turno. En el gateway, `zone=citas` permite 10 peticiones por segundo por IP (ráfaga de 40).

**Evidencia:** CP-39 manda 3 reservas simultáneas para 2 cupos: entran 2, la tercera recibe 409 y en la BD hay exactamente 2 citas. CP-41 comprueba que la 6.ª cita próxima de un cliente se rechaza. CP-43 comprueba que no se reserva en un turno bloqueado.

---

## A08 — Software & Data Integrity Failures

**Riesgo:** alguien llama al webhook con un `payment_intent.succeeded` inventado para que un pedido figure como pagado sin pagar, o reenvía un webhook real capturado antes.

**Controles (`services/pagos/src/Stripe.php`, `PagosController::webhookStripe()`):**

1. Sin `Stripe-Signature` válida no se procesa nada. Se calcula `HMAC-SHA256(t + "." + cuerpo_crudo, STRIPE_WEBHOOK_SECRET)` y se compara con `hash_equals` contra cada `v1`.
2. Si `t` tiene más de 300 s de diferencia con la hora del servidor, se rechaza (anti-replay).
3. `webhook_eventos.event_id` es la clave primaria: un evento repetido responde 200 sin reprocesarse.
4. Aunque la firma sea válida, el pago solo se confirma si `amount_received`, `currency` y `metadata.pedido_id` coinciden con lo guardado. Si no coinciden, queda `PAGO_FALLIDO` con resultado `FRAUDE`.
5. Todo intento rechazado queda en la bitácora: `WEBHOOK_STRIPE_RECIBIDO` con FALLO (sin firma) o FRAUDE (firma falsa).

**Evidencia:** CP-26 cubre sin firma, firma falsa, firma vieja, cuerpo alterado, firma válida y evento repetido. CP-27 cubre el monto manipulado y la tarjeta rechazada.

Ver también [`03-pci-dss-pagos.md`](03-pci-dss-pagos.md).

---

## A09 — Catálogo de eventos de la bitácora

Cada servicio solo puede registrar sus propios eventos: `AuditController::EVENTOS` guarda qué servicios pueden emitir cada código, y el servicio se toma del JWT de servicio, no del cuerpo. Todos los eventos quedan append-only y encadenados con SHA-256 (CP-12, CP-13).

La bitácora no copia datos sensibles: ni contraseñas, ni datos de tarjeta, ni diagnósticos, ni el texto de las adendas (A.5.34).

Resultado: **E** éxito, **F** fallo, **X** fraude. ✱ = evento agregado después de la FASE 15.

**Los 14 obligatorios del enunciado** (CP-32 comprueba que todos aparecen):

| Evento | Servicio | Cuándo | Resultado | Prueba |
|---|---|---|---|---|
| `LOGIN_CLIENTE_EXITOSO` | auth | Inicio de sesión, con o sin MFA | E | CP-12, CP-34 |
| `LOGIN_CLIENTE_FALLIDO` | auth | Contraseña o código MFA equivocado; X si el mismo correo falla desde varias IP | F, X | CP-12, CP-34 |
| `REGISTRO_CLIENTE` | auth | Registro público o alta desde el panel (`origen` y `creado_por`) | E | CP-12 |
| `ACCESO_ADMIN_PANEL` | auth | Entrada al panel; F si el rol no es del personal | E, F | CP-12, CP-31 |
| `TOKEN_REVOCADO` | auth | Cierre de sesión (el `jti` pasa a la lista negra) | E | CP-12 |
| `EXPORTACION_CLIENTES` | auth | Generación del reporte de clientes en PDF, con la cantidad de registros | E | CP-31 |
| `PEDIDO_CREADO` | pedidos | Checkout | E | CP-18 |
| `PEDIDO_ESTADO_CAMBIADO` | pedidos | Cambio de estado por el personal, el cliente, el pago o el vencimiento | E | CP-22, CP-26, CP-33 |
| `PAGO_INICIADO` | pagos | Se crea el PaymentIntent u orden de PayPal (con el tipo de cambio si es PayPal) | E, F | CP-29 |
| `PAGO_CONFIRMADO` | pagos | Webhook de Stripe o captura de PayPal que cuadran con el pedido | E | CP-11, CP-26 |
| `PAGO_FALLIDO` | pagos | Tarjeta rechazada; X si el monto, la moneda o el pedido no cuadran | F, X | CP-27 |
| `WEBHOOK_STRIPE_RECIBIDO` | pagos | Todo aviso de Stripe; F sin firma, X con firma falsa | E, F, X | CP-26 |
| `PRECIO_MODIFICADO` | catálogo | Cambio de precio de una presentación | E | CP-21 |
| `PRODUCTO_AGOTADO` | catálogo, pedidos | El stock llega a 0 | E | CP-22 |

**Los 24 extra:**

| Evento | Servicio | Cuándo | Resultado | Prueba |
|---|---|---|---|---|
| `MFA_CONFIGURADO` | auth | Activar o desactivar la verificación en dos pasos | E, F | CP-34 |
| `ROL_CAMBIADO` ✱ | auth | El admin cambia el rol de un usuario (rol anterior y nuevo) | E | CP-49 |
| `PASSWORD_CAMBIADO` ✱ | auth | Cambio de contraseña con la actual (`era_temporal`) | E | CP-49 |
| `REEMBOLSO_PENDIENTE` ✱ | pedidos | Se cancela un pedido cobrado, o llega un pago de un pedido ya cancelado | E | CP-50 |
| `REEMBOLSO_REGISTRADO` ✱ | pedidos | El personal marca el reembolso como hecho, con la referencia | E | CP-50 |
| `PAGO_REEMBOLSADO` ✱ | pagos | Reembolso pedido a Stripe o PayPal por su API | E | CP-50 (sin claves: 503, Zero Trust e idempotencia; el reembolso real necesita claves sandbox) |
| `EMAIL_ENVIADO` | notificaciones | Correo de pedido o de cita (F si EmailJS falla) | E, F | CP-26, CP-42 |
| `PRODUCTO_CREADO` ✱ | catálogo | Alta de producto desde el panel | E | CP-47 |
| `PRODUCTO_ACTUALIZADO` ✱ | catálogo | Edición de ficha, presentaciones nuevas o moderación de una reseña | E | CP-50 |
| `RESENA_PUBLICADA` ✱ | catálogo | Un cliente que compró opina (queda oculta hasta moderarla) | E | CP-50 |
| `MASCOTA_REGISTRADA` | citas | Alta de mascota | E | CP-37 |
| `MASCOTA_ACTUALIZADA` | citas | Edición, alertas médicas o baja de una mascota | E | CP-37 |
| `CITA_CREADA` | citas | Reserva (cliente o personal) | E | CP-38 |
| `CITA_CANCELADA` | citas | Cancelación | E | CP-40 |
| `CITA_ESTADO_CAMBIADO` | citas | Confirmada, atendida o no asistió (también automático) | E | CP-40, CP-44, CP-46 |
| `CITA_REPROGRAMADA` ✱ | citas | Cambio de día, hora o profesional (horario anterior y nuevo) | E | CP-51 |
| `PROFESIONAL_ACTUALIZADO` ✱ | citas | Alta o cambio de horario de un profesional del equipo | E | CP-51 |
| `TURNO_BLOQUEADO` | citas | Bloqueo de un día o de un turno (feriado, mantenimiento) | E | CP-43 |
| `TURNO_DESBLOQUEADO` | citas | Se quita un bloqueo | E | CP-43 |
| `HISTORIAL_REGISTRADO` | citas | Ficha de consulta, nota, adjunto o vacuna externa (sin el diagnóstico) | E | CP-44 |
| `HISTORIAL_CONSULTADO` | citas | Lectura del historial clínico de una mascota | E | CP-45 |
| `HISTORIAL_CORREGIDO` ✱ | citas | Adenda a una ficha (el texto no va a la bitácora) | E | CP-51 |
| `RECORDATORIO_ENVIADO` | citas | Recordatorio de cita o aviso de vacuna por vencer | E, F | CP-46 |
| `ACCESO_DENEGADO` | todos | Intento de ver o editar un pedido, una mascota o una cita ajenos | F | CP-20, CP-37, CP-45 |

`PAGO_REEMBOLSADO` con éxito necesita claves sandbox de Stripe o PayPal: sin ellas, CP-50 comprueba que el reembolso no se marca como hecho, que solo `pedidos-service` puede pedirlo y que uno ya hecho no se vuelve a pedir.
