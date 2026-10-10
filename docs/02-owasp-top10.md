# Huellitas — Controles OWASP Top 10 (2021)

Cada control indica **dónde está en el código** y **qué caso de `tests/seguridad.sh` lo comprueba**.
Estado al cierre de la semana 3: los 7 controles (A01, A02, A03, A05, A07, A08 y A09) implementados.

| ID | Amenaza | Control | Código | Prueba |
|---|---|---|---|---|
| A01 | Broken Access Control | `id_cliente` del JWT en cada consulta de pedidos; 404 idéntico para "no existe" y "es de otro"; rutas admin con `Guard::usuario(['admin'])` | `services/pedidos/src/PedidosController.php` (`misPedidos`, `ver`), `services/shared/src/Guard.php` | CP-07, CP-20 |
| A02 | Cryptographic Failures | bcrypt cost 12; solo TLS 1.3 + HSTS; sin datos de tarjeta en ninguna BD; JWT HS256 con secretos de 48 caracteres en `.env` | `services/auth/src/AuthController.php` (`BCRYPT`), `gateway/default.conf.template` (`ssl_protocols`), `db/master/*.sql` | CP-01, CP-02, CP-05 |
| A03 | Injection | PDO sin emulación de prepared statements; validación de tipo y rango; WAF en Nginx (URL, cabeceras) y en PHP (cuerpo JSON) | `services/shared/src/Db.php`, `services/shared/src/Validar.php`, `gateway/default.conf.template` (`map $waf_*`) | CP-10, CP-24 |
| A05 | Security Misconfiguration | Secretos solo en `.env`; BD y Redis sin puertos publicados; contenedores PHP como `www-data`, `read_only`, `cap_drop: ALL`; sin versiones en cabeceras; errores genéricos | `docker-compose.yml`, `services/Dockerfile`, `services/shared/src/Router.php` | CP-03, CP-14 |
| A07 | Identification & Authentication Failures | 5 intentos → bloqueo 15 min; rate limit en `/login`; JWT de 1 h; logout → lista negra Redis; mismo mensaje y mismo tiempo exista o no el correo; **verificación en dos pasos TOTP** (secreto cifrado AES-256-GCM, desafío de 5 min y un solo uso, códigos no reutilizables, los códigos fallidos cuentan para el bloqueo) | `AuthController::login()`, `verificarMfa()`, `Totp.php`, `Cache::revocar()`, `zone=login` | CP-05, CP-08, CP-09, CP-16, CP-34 |
| A08 | Software & Data Integrity Failures | Firma `Stripe-Signature` del webhook (HMAC, tolerancia 5 min, idempotencia) y verificación de monto; cadena de hashes en la bitácora; dependencias fijadas con `package-lock.json` | `services/pagos/src/Stripe.php::firmaValida()`, `AuditController::integridad()` | CP-12, CP-26, CP-27 |
| A09 | Security Logging & Monitoring Failures | `security-audit-service` con eventos append-only; cada servicio reporta los suyos | `services/audit/src/AuditController.php`, `services/shared/src/Auditoria.php` | CP-12, CP-13 |

---

## A01 — Broken Access Control

**Riesgo en el e-commerce:** un cliente cambia el ID de la URL (`/api/pedidos/…`) y ve la dirección, el teléfono y la compra de otra persona. Otro riesgo es un cliente que llama a rutas de administración.

**Controles:**

1. **El filtro sale del token, nunca de un parámetro.** `misPedidos()` hace `WHERE p.id_cliente = ?` con `$claims['sub']`, el ID que viene dentro del JWT firmado. El cliente no tiene forma de pedir los pedidos de otro.
2. **Detalle de un pedido.** `ver()` busca primero el dueño. Si no coincide con el `sub` del token y el rol no es admin, responde **404**, igual que si el pedido no existiera, para no confirmar que existe. Además registra `ACCESO_DENEGADO` en la bitácora, lo que permite detectar a alguien probando IDs.
3. **IDs no adivinables.** Los pedidos usan UUID v4 (`Jwt::uuid()`, 122 bits aleatorios), no enteros consecutivos.
4. **Rutas administrativas.** Precios, stock, estados de pedido y bitácora exigen `Guard::usuario(['admin'])`. El rol viene del token firmado, y el registro público siempre crea `cliente` aunque el cuerpo diga `"rol":"admin"`.
5. **Servicio a servicio.** `/internal/*` no se publica en el gateway, y cada ruta interna acepta solo a ciertos servicios. Por ejemplo, solo `pedidos-service` puede reservar stock.

```php
// services/pedidos/src/PedidosController.php — misPedidos()
$consulta = Db::lectura()->prepare(self::SQL_RESUMEN . ' WHERE p.id_cliente = ? GROUP BY p.id ORDER BY p.fecha DESC LIMIT 100');
$consulta->execute([(int) $claims['sub']]);
```

**Evidencia:** CP-20. El cliente B pide el pedido del cliente A y recibe 404, y la bitácora registra `ACCESO_DENEGADO` con el ID del pedido y el correo de B.

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

