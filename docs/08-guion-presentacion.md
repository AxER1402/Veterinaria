# Huellitas — Guion de la presentación (10 min)

**Antes de empezar** (5 min antes, no cuenta en el tiempo):

```bash
docker compose up -d && docker compose ps          # los 14 contenedores en healthy
tests/seguridad.sh | tail -1                        # "295 pasaron, 0 fallaron"
```

- Pestaña 1: la tienda (`/tienda`) en una ventana privada.
- Pestaña 2: el panel `/admin`, con la sesión de admin ya iniciada.
- La cuenta `cliente@huellitas.gt` con una mascota ya registrada en `/cuenta/mascotas`, para no perder tiempo en el alta.
- Una terminal con letra grande en la carpeta del proyecto.
- Si hay claves de Stripe: `stripe listen --forward-to https://localhost:8443/api/pagos/webhook/stripe --skip-verify` corriendo.
- Tener a mano `docs/pdf/SEC-1-Huellitas-Seguridad.pdf` y `docs/zap/zap-baseline-2.html`.

| Min | Bloque | Qué se muestra | Qué se dice (idea clave) |
|---|---|---|---|
| 0:00 | **Negocio y arquitectura** | Diagrama de arquitectura de SEC-1, pág. 2 | Tienda de mascotas y clínica veterinaria, distinta del Proyecto 1 (POS de librería). 7 microservicios PHP (incluido `citas-service`) + gateway + MariaDB maestro/réplica + BD de auditoría aparte + Redis. Zero Trust: cada servicio verifica el JWT, incluso entre servicios |
| 1:00 | **Compra completa** (cliente) | Catálogo sin login → producto → carrito con el cupón `HUELLITAS10` → checkout pide cuenta → registro → envío a domicilio → «Confirmar pedido» | El total lo calcula el servidor: el navegador solo manda IDs y cantidades |
| 2:15 | **Pago** | «Tarjeta» → Stripe Payment Element → `4242 4242 4242 4242` → pedido «Pagado» en *Mis pedidos*. *Sin claves:* `tests/seguridad.sh` CP-26 o el webhook firmado a mano (abajo) | La tarjeta va directo a Stripe. El pedido pasa a pagado solo cuando llega el webhook con firma válida. Pedidos con UUID: no se pueden adivinar |
| 3:00 | **Reservar una cita** (cliente) | `/servicios` → «Reservar» en Consulta veterinaria → día → turno libre → mascota → *Mis citas* con el código de verificación | La sede sale del servicio. La BD impide la doble reserva: si llegan 3 reservas a la vez para 2 cupos, entran 2 (CP-39). Máximo 5 citas próximas por cliente |
| 3:45 | **Ataques en vivo** (terminal) | 1) Pedido ajeno → 404 · 2) Precio manipulado → se ignora · 3) Webhook sin firma → 400 · 4) `' OR 1=1` → 403 del WAF · 5) Cliente pide la agenda del veterinario → 403 | Ver los comandos abajo. Cada intento queda en la bitácora |
| 5:00 | **Panel admin** | Agenda: confirmar la cita recién reservada (sale el correo de confirmación) → Bitácora: filtrar `CITA_ESTADO_CAMBIADO`, `FRAUDE` y `ACCESO_DENEGADO`, abrir un evento con antes/después, «Verificar integridad» | Bitácora append-only: triggers + usuario solo INSERT/SELECT + cadena de hashes. 27 tipos de evento: los 14 obligatorios y 13 extra. El diagnóstico de una consulta no se copia a la bitácora |
| 6:15 | **Cambio de precio** | Catálogo: cambiar un precio → aparece `PRECIO_MODIFICADO` con el precio anterior y el nuevo | Trazabilidad de cada cambio administrativo |
| 6:45 | **PCI-DSS y hardening** | `docs/evidencia/README.md`: SEC-3 (`SELECT * FROM pagos`) y SEC-5 (`docker ps`) | Sin tarjetas en la BD (las citas se pagan en la sede), BD y Redis sin puertos, contenedores como www-data, secretos solo en `.env` |
| 7:30 | **Recuperación en vivo** | `ops/simulacro-drp.sh --si` (unos 40 s en total) | Ransomware destruye maestro y réplica. Se restauran el respaldo cifrado y los binlogs. RTO de unos 14 s, sin pérdida: los conteos de pedidos, pagos, citas e historial clínico coinciden |
| 8:45 | **ZAP, ALE/ROSI y cierre** | `zap-baseline-2.html` (0 FAIL, 0 alertas medias) · tabla de ROSI de SEC-1 | La pérdida esperada baja de USD 24,300 a 1,910 al año, con USD 162 de presupuesto: ROSI de unas 137 veces |

## Comandos de la demo de ataques (min 3:45)

```bash
B=https://localhost:8443
login() { curl -sk -X POST -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" $B/api/auth/login | jq -r .token; }
CLIENTE=$(login cliente@huellitas.gt 'Cliente#2026')

# 1) A01: el cliente pide el pedido de otra persona (copiar un ID desde /admin/pedidos)
curl -sk -H "Authorization: Bearer $CLIENTE" $B/api/pedidos/<uuid-ajeno> ; echo     # → 404 + ACCESO_DENEGADO

# 2) Tampering: comprar a 1 centavo
curl -sk -X POST -H 'Content-Type: application/json' \
  -d '{"items":[{"variante_id":1,"cantidad":1,"precio":0.01}],"metodo_entrega":"retiro"}' $B/api/pedidos/cotizar | jq .totales   # → 19.99

# 3) A08: webhook de pago falso, sin firma
curl -sk -X POST -d '{"type":"payment_intent.succeeded"}' $B/api/pagos/webhook/stripe ; echo   # → 400 Firma inválida

# 4) A03: inyección SQL en la URL
curl -sk -o /dev/null -w '%{http_code}\n' "$B/tienda?q=1'%20OR%20'1'='1"                          # → 403

# 5) A01 / E de STRIDE: un cliente pide la agenda del veterinario
curl -sk -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CLIENTE" "$B/api/citas/admin/agenda?fecha=$(date +%F)"   # → 403
```

## Pago sin claves de Stripe (respaldo para el min 2:15)

Si las claves de sandbox no están configuradas, se muestra el mismo flujo que hace Stripe: se firma el webhook con el secreto local.

```bash
tests/seguridad.sh 2>&1 | sed -n '/CP-26/,/CP-28/p'    # firma ausente, falsa, vieja, alterada y válida → pedido pagado
```

## Preguntas probables

| Pregunta | Respuesta corta | Dónde |
|---|---|---|
| ¿Por qué no un monolito? | 7 servicios con su propia BD y usuario. Un servicio comprometido no lee otras bases (A.8.3) | CP-25 |
| ¿Cómo se evita que un servicio falsee eventos? | El servicio sale del token, no del cuerpo, y cada evento tiene sus servicios permitidos | `AuditController::EVENTOS` |
| ¿Y si borran la bitácora directamente en la BD? | Los triggers lo impiden incluso a root. Si quitan el trigger, la cadena de hashes lo delata | CP-13, «Verificar integridad» |
| ¿Qué pasa si Redis se cae? | Fail closed: los servicios devuelven 503 en vez de aceptar tokens sin revisar la lista negra | `Cache::redis()` |
| ¿Cuál es el RPO real? | Respaldo completo cada 4 h + binlogs cada 5 min → ≤ 5 min | `docs/04-bcp-drp.md` §3 |
| ¿Por qué quedan alertas en ZAP? | Son bajas: COEP/COOP romperían Stripe, PayPal y Maps, y la otra es un falso positivo. Están justificadas | `docs/zap/README.md` |
| ¿Cómo evitan que dos clientes reserven el mismo cupo? | Índice `UNIQUE (sede, inicio, cupo)`: la BD rechaza el segundo INSERT aunque lleguen a la vez, y ese cliente recibe 409 | CP-39, `docs/02-owasp-top10.md` |
| ¿Quién ve el diagnóstico de una mascota? | El admin y el veterinario; recepción y tienda reciben 403. Cada lectura queda como `HISTORIAL_CONSULTADO`. El dueño ve el carné de vacunas, sin diagnósticos | CP-44, CP-45, CP-49 (A.5.34) |
| ¿Qué puede hacer cada rol del personal? | Mínimo privilegio: recepción maneja agenda y clientes, el veterinario además el historial clínico, la tienda pedidos y catálogo. Solo el admin ve la bitácora, exporta clientes y asigna roles (nunca el suyo), y cada cambio queda como `ROL_CAMBIADO` | CP-49, `docs/02-owasp-top10.md` (A01) |
| La bitácora del enunciado tiene `rol ENUM(admin,cliente,anonimo)`, ¿por qué hay más? | Se amplió con `veterinario`, `recepcion` y `tienda`. Si todo el personal quedara como `admin`, la bitácora no diría quién hizo qué (R de STRIDE) y todos tendrían todos los permisos (A.5.15). Los tres valores del enunciado siguen igual, y la migración no tocó registros ni la cadena de hashes | `db/audit/02-roles-personal.sql`, CP-13 |
