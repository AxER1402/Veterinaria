# Implementación — Plataforma E-Commerce Distribuida con Seguridad y Auditoría

> Resumen paso a paso de `instrucciones.docx`. Curso: **Auditoría y Seguridad de Sistemas**.
> Entrega máxima: **31 de octubre de 2026** (descuento de -1 pt por día de retraso).

---

## 0. Descripción general

Diseñar, desarrollar y desplegar una **plataforma E-Commerce distribuida con arquitectura de microservicios** que además incluye, de forma obligatoria:

1. Capa de seguridad **end-to-end basada en OWASP Top 10**.
2. Un **microservicio de auditoría** dedicado (`security-audit-service`).
3. Un **plan BCP/DRP** específico para e-commerce.
4. Un **presupuesto de ciberseguridad** con metodología **ALE/ROSI**.

> ⚠️ El tipo de negocio debe ser **diferente** al elegido en el Proyecto 1 (el actual repo es una veterinaria "Huellitas"; sirve como frontend/tienda del nuevo negocio o debe reemplazarse por uno distinto al del Proyecto 1).

---

## FASE 1 — Arquitectura y repositorio base

### Paso 1.1 — Definir negocio y alcance
- Elegir un tipo de negocio de e-commerce **distinto al Proyecto 1**.
- Definir flujo completo: **catálogo → carrito → checkout → pago → confirmación por email → entrega**.

### Paso 1.2 — Arquitectura de microservicios (mínimo 4, óptimo 5+)

| Microservicio | Responsabilidad | Tech | Puerto |
|---|---|---|---|
| API Gateway (Nginx) | Entrada única, reverse proxy, rate limiting, WAF | Nginx Alpine | 80/443 |
| auth-service | Registro, login, JWT, roles cliente/admin | PHP 8+ + auth_db | 8081 |
| catalogo-service | Productos, categorías, imágenes Cloudinary, stock | PHP 8+ + catalogo_db | 8082 |
| pedidos-service | Carrito, pedidos, estado de entrega, historial | PHP 8+ + pedidos_db | 8083 |
| pagos-service | Checkout, Stripe/PayPal, confirmación de pago | PHP 8+ + pagos_db | 8084 |
| notificaciones-service | Emails (EmailJS), confirmaciones | PHP 8+ / Node | 8085 |
| **security-audit-service** | Registro de eventos de seguridad y trazabilidad | PHP 8+ + audit_db | 8086 |
| MariaDB Master | Todas las escrituras | MariaDB 10.6 | 3306 (interno) |
| MariaDB Slave | Lecturas de catálogo/reportes | MariaDB 10.6 | 3307 (interno) |
| Redis Cache | Caché catálogo, sesiones, JWT revocados | Redis 7 | 6379 (interno) |

### Paso 1.3 — Componentes de seguridad de infraestructura
- **Lista negra JWT (Redis):** cada servicio consulta Redis antes de aceptar un JWT.
- **WAF básico (Nginx):** bloqueo de payloads SQLi/XSS conocidos en headers/body.
- **HTTPS TLS 1.3:** Let's Encrypt en todos los endpoints públicos; HTTP redirige a HTTPS.

### Paso 1.4 — Repositorio GitHub privado
- Crear repo **privado** con todos los microservicios, `docker-compose.yml` y `README`.
- Verificar `.gitignore` incluye `.env`.

> 🔒 **Zero Trust:** cada microservicio verifica el JWT en CADA petición interna, aunque venga de otro servicio.

---

## FASE 2 — Controles OWASP Top 10 para E-Commerce

Implementar y documentar (mínimo 5, ideal 7 incluyendo A08). Referenciar en el código.

| ID | Amenaza | Control a implementar |
|---|---|---|
| A01 | Broken Access Control | Verificar `id_cliente` del JWT == `id_cliente` del pedido en CADA consulta. Cliente no ve pedidos de otro. |
| A02 | Cryptographic Failures | NUNCA almacenar tarjeta; solo `transaction_id`. HTTPS obligatorio. `bcrypt(cost≥12)` en contraseñas. |
| A03 | Injection | Prepared statements en el 100% de queries. Validar/sanitizar todos los campos de carrito y checkout. |
| A05 | Security Misconfiguration | `.env` para API keys; puertos BD/Redis NO expuestos; contenedores app sin root. |
| A07 | Auth Failures | Rate limiting en `/login` (5 intentos → bloqueo 15 min); JWT expira 1h; logout invalida token en Redis. |
| A08 | Software & Data Integrity | Verificar firma `Stripe-Signature` del webhook; no procesar pagos sin firma válida. |
| A09 | Security Logging | `security-audit-service` registra logins, pagos, cambios de estado, exportaciones, accesos fallidos. |

> ⚠️ **Crítico:** nunca almacenar número de tarjeta, CVV ni fecha de expiración en la BD propia.

---

## FASE 3 — Modelado de amenazas STRIDE (ciclo de compra completo)

| STRIDE | Flujo | Ataque ejemplo | Contramedida |
|---|---|---|---|
| **S** Spoofing | Login/checkout | Credential stuffing | Rate limiting + bcrypt + detección multi-IP |
| **T** Tampering | Precio carrito frontend | Modificar precio en POST /api/pedidos | Precio SIEMPRE desde catalogo-service en servidor |
| **R** Repudiation | Confirmación de pago | Cliente niega el pago | audit-service + referencia Stripe inmutable + email firmado |
| **I** Info Disclosure | Listado de pedidos | GET /api/pedidos sin filtro | `WHERE id_cliente = {JWT}`; usar **UUID** no IDs secuenciales |
| **D** DoS | Catálogo | Scraping masivo | Redis cache + rate limiting por IP + CDN Cloudinary |
| **E** Elevation of Privilege | Panel admin | Manipular JWT para ser admin | Verificación de firma; rol nunca viene del cliente |

- Elaborar **diagrama STRIDE** + **DFD** del flujo completo.

---

## FASE 4 — Registros de auditoría (trazabilidad del ciclo de compra)

### Paso 4.1 — Crear tabla `security_audit_logs` (en `audit_db`)

| Campo | Tipo | Descripción |
|---|---|---|
| id | BIGINT AUTO_INCREMENT PK | Identificador único |
| timestamp | DATETIME(3) NOT NULL | Fecha/hora en ms |
| usuario_id | INT / NULL | ID usuario (NULL anónimo) |
| usuario_email | VARCHAR(120) | Email autenticado |
| rol | ENUM(admin,cliente,anonimo) | Rol del actor |
| accion | VARCHAR(80) NOT NULL | Código de evento |
| servicio | VARCHAR(50) | Microservicio origen |
| pedido_id | INT / NULL | Pedido relacionado |
| pago_id | INT / NULL | Pago relacionado |
| dato_anterior | JSON | Estado previo |
| dato_nuevo | JSON | Estado nuevo |
| ip_origen | VARCHAR(45) | IP del cliente |
| user_agent | VARCHAR(255) | Navegador/dispositivo |
| resultado | ENUM(EXITO,FALLO,FRAUDE) | Resultado |

### Paso 4.2 — Implementar los 14 eventos obligatorios

| Código | Cuándo | Servicio |
|---|---|---|
| LOGIN_CLIENTE_EXITOSO | Login correcto | auth-service |
| LOGIN_CLIENTE_FALLIDO | Credenciales incorrectas | auth-service |
| REGISTRO_CLIENTE | Nuevo registro | auth-service |
| PEDIDO_CREADO | Cliente confirma carrito | pedidos-service |
| PAGO_INICIADO | Inicio de pago (antes de Stripe) | pagos-service |
| PAGO_CONFIRMADO | Stripe/PayPal confirma | pagos-service |
| PAGO_FALLIDO | Pago rechazado | pagos-service |
| PEDIDO_ESTADO_CAMBIADO | Admin cambia estado | pedidos-service |
| PRECIO_MODIFICADO | Admin cambia precio | catalogo-service |
| PRODUCTO_AGOTADO | Stock llega a 0 | catalogo-service |
| EXPORTACION_CLIENTES | Admin exporta datos | admin panel |
| ACCESO_ADMIN_PANEL | Admin entra al panel | auth-service |
| WEBHOOK_STRIPE_RECIBIDO | Evento Stripe + verificación de firma | pagos-service |
| TOKEN_REVOCADO | Logout; token a blacklist Redis | auth-service |

> 🔒 Tabla **append-only**: ningún endpoint permite UPDATE ni DELETE.

---

## FASE 5 — Seguridad del módulo de pagos (PCI-DSS básico)

| Requisito PCI-DSS | Implementación |
|---|---|
| No almacenar datos de tarjeta | Solo `payment_intent_id` / `transaction_id` de Stripe |
| Cifrado en tránsito | HTTPS/TLS 1.3; HTTP redirige a HTTPS |
| Control de acceso | `/api/pagos/*` solo acepta llamadas internas de pedidos-service con JWT de servicio |
| Logging de transacciones | Cada intento (éxito/fallo) → audit-service con `reference_id` |
| Verificación de webhooks | Validar firma `Stripe-Signature` con Webhook Secret; rechazar y registrar sin firma |
| API keys en entorno | `sk_test_...` y PayPal solo en `.env`, nunca en repositorio |

**Verificación en presentación:** (1) sin datos de tarjeta en BD, (2) webhook verifica firma, (3) API keys en `.env`.

---

## FASE 6 — Plan BCP/DRP

### Paso 6.1 — BIA por servicio (RTO/RPO)

| Microservicio | Criticidad | RTO | RPO |
|---|---|---|---|
| pagos-service | CRÍTICA | 10 min | 0 |
| catalogo-service | CRÍTICA | 15 min | 5 min |
| auth-service | CRÍTICA | 10 min | 0 |
| pedidos-service | ALTA | 20 min | 5 min |
| security-audit-service | ALTA | 30 min | 15 min |
| notificaciones-service | MEDIA | 60 min | 30 min |
| BD Master | CRÍTICA | 10 min | 5 min |
| Redis Cache | ALTA | 15 min | 0 (recomputar) |

### Paso 6.2 — 6 escenarios de incidente + respuesta

| Escenario | Prob. | Impacto | Respuesta |
|---|---|---|---|
| Ransomware en BD Master | Media | Crítico | Sitio B (Render); restaurar backup cifrado S3; RTO 45 min |
| DDoS al API Gateway | Alta | Alto | Cloudflare free + rate limiting + escalar horizontalmente |
| Fuga de datos de clientes | Baja | Crítico | Aislar servicio; notificar <72h; revisar audit logs |
| Fallo hosting principal (Render) | Baja | Alto | Conmutar DNS a Railway (sitio B); docker-compose listo |
| Expiración TLS | Alta | Alto | Let's Encrypt renovación automática cada 90 días |
| Credenciales admin comprometidas | Media | Crítico | Revocar JWT en Redis; forzar cambio de contraseña; revisar logs |

### Paso 6.3 — Estrategia de backup

| Componente | Tipo | Frecuencia | Retención | Almacenamiento |
|---|---|---|---|---|
| BD Master | Completo diario + incremental 4h | Diario/4h | 30 días | S3/R2 cifrado AES-256 |
| Imágenes productos | CDN redundante | Continuo | Indefinido | Cloudinary |
| Código fuente | Git | Por push | Indefinido | GitHub privado |
| Imágenes Docker | CI/CD build | Por release | 5 últimas | Docker Hub/GHCR |
| Logs auditoría | Streaming incremental | Cada hora | 2 años | S3 con Object Lock |
| Config Nginx/compose | Repo GitHub | Por cambio | Historial Git | GitHub privado |

> 📋 Incluir **diagrama de topología de recuperación** (sitio B, failover DNS, tiempos). Objetivo: operativo en **< 60 min**.

---

## FASE 7 — Presupuesto de seguridad (ALE/ROSI)

### Paso 7.1 — Análisis ALE (ajustar al negocio elegido)

| Amenaza | SLE | ARO | ALE | Control | Costo/año | ALE post | ROSI |
|---|---|---|---|---|---|---|---|
| Fuga datos tarjetas | 25,000 | 0.3 | 7,500 | No almacenar tarjetas | 0 | 0 | +7,500 |
| Cuenta cliente comprometida | 500 | 12.0 | 6,000 | Rate limit + bcrypt + Redis | 0 | 600 | +5,400 |
| Ransomware servidor | 20,000 | 0.4 | 8,000 | Backups S3 + DRP | 300 | 800 | +6,900 |
| DDoS (4h ventas) | 3,200 | 2.0 | 6,400 | Cloudflare + rate limit | 0 | 640 | +5,760 |
| Scraping precios | 1,500 | 4.0 | 6,000 | Redis cache + rate limit IP | 0 | 600 | +5,400 |
| Webhook pago falso | 5,000 | 1.0 | 5,000 | Firma Stripe-Signature | 0 | 0 | +5,000 |

### Paso 7.2 — Presupuesto total (costo estimado anual)

| Categoría | Herramienta | Costo/año |
|---|---|---|
| Pagos seguros | Stripe/PayPal Sandbox | 0 |
| CDN + DDoS | Cloudflare Free | 0 |
| Certificado TLS | Let's Encrypt | 0 |
| Backups | Cloudflare R2 (10 GB gratis) | 0 – 50 |
| Imágenes CDN | Cloudinary (25 GB/mes) | 0 |
| Cache/tokens | Redis (Docker/Railway) | 0 – 60 |
| Hosting HTTPS | Render/Railway free | 0 – 120 |
| Scanner vulns | OWASP ZAP | 0 |
| SAST | Semgrep CE (GitHub Actions) | 0 |
| Contingencia (10%) | — | 23 – 35 |
| **TOTAL** | | **USD 23 – 265 / año** |

> ROSI total ≈ **+USD 36,000/año** de pérdidas evitadas con controles casi gratis.

---

## FASE 8 — APIs externas (mínimo 3 obligatorias)

| API | Uso | Seguridad |
|---|---|---|
| Stripe Payments | Checkout con tarjeta (sandbox) + webhook | API key en `.env`; verificar `Stripe-Signature` |
| PayPal Sandbox | Alternativa botón PayPal | Client ID/Secret en `.env`; HTTPS |
| Google Maps Embed | Mapa de ubicación/delivery | Restricción de dominio |
| EmailJS | Email de confirmación | Service ID/Template en `.env`; registrar envío en audit |
| Cloudinary | CDN imágenes optimizadas | API Key/Secret en `.env`; upload firmado |
| OpenWeatherMap | Clima en dashboard admin | API key en `.env`; máx 1000 req/día. Hecho (16 oct): sin clave usa Open-Meteo; caché de 10 min en Redis (CP-36) |

---

## FASE 9 — Base de datos (por servicio, sin datos de tarjeta)

| Servicio | BD | Tablas principales |
|---|---|---|
| auth-service | auth_db | `usuarios` (id, nombre, email, password_hash, rol, activo, intentos_fallidos, bloqueado_hasta, created_at) |
| catalogo-service | catalogo_db | `categorias`, `productos` (id, nombre, precio, stock, imagen_url, destacado, activo, updated_by, updated_at) |
| pedidos-service | pedidos_db | `clientes`, `pedidos` (id, id_cliente, total, estado, fecha), `detalle_pedidos`, `direcciones_entrega` |
| pagos-service | pagos_db | `pagos` (id, id_pedido, monto, metodo, payment_intent_id, stripe_status, fecha_pago) — **SIN datos de tarjeta** |
| security-audit-service | audit_db | `security_audit_logs` (sección FASE 4) |

- **Scripts SQL** por BD con **mínimo 20 productos** y datos de prueba.
- Verificar que **ninguna** tabla tenga columnas `card_number`, `cvv`, etc.

---

## FASE 10 — Controles ISO 27001:2022

| Control | Implementación |
|---|---|
| A.5.15 Control de acceso | JWT con roles; cliente solo ve sus pedidos |
| A.8.3 Restricción de acceso | Cada microservicio accede solo a su BD |
| A.8.24 Uso de criptografía | bcrypt; TLS 1.3; AES-256 backups; HMAC webhooks |
| A.8.15 Registro de actividades | audit-service con los 14 eventos |
| A.8.20 Seguridad de redes | Docker network isolation; BD/Redis no expuestos; Cloudflare |
| A.5.29 Continuidad del negocio | BCP/DRP con RTO/RPO y escenarios |
| A.8.13 Respaldo de información | Backups cifrados en S3 + prueba de restauración |
| A.5.34 Privacidad y protección de datos | Política de datos mínimos |

---

## FASE 11 — Docker con hardening

`docker-compose up --build -d` debe levantar TODO. Requisitos de seguridad:

| Requisito | Implementación |
|---|---|
| No exponer BD al exterior | `mariadb-master` y Redis **sin** `ports:` |
| Variables en `.env` | Secretos/API keys en `.env` (en `.gitignore`) |
| Usuario no-root | Dockerfiles PHP con `USER www-data` |
| Volúmenes separados | `audit_db` en volumen independiente de las BDs de negocio |
| Red interna | `networks:` interna; comunicación por nombre de contenedor |
| Resource limits | `mem_limit` y `cpu_shares` para evitar agotamiento por DDoS |

---

## FASE 12 — Entregables

### Técnicos
- [ ] URL pública del E-Commerce (catálogo accesible sin registro).
- [ ] URL del Panel de Administración (usuario/contraseña de prueba).
- [ ] Repositorio **GitHub privado** con microservicios, `docker-compose.yml` y README.
- [x] Scripts SQL por BD con mínimo 20 productos y datos de prueba. → `db/master/` (24 productos, 40 variantes) y `db/audit/`
- [ ] Presentación 10 min con demo del flujo completo de compra.

### Auditoría y Seguridad
- [x] **[SEC-1]** Documento PDF con: diagrama STRIDE, tabla OWASP con refs de código, lineamientos PCI-DSS, presupuesto ALE/ROSI, plan BCP/DRP con 6 escenarios. → `docs/pdf/SEC-1-Huellitas-Seguridad.pdf`
- [x] **[SEC-2]** Captura de **≥30 registros** en `security_audit_logs` cubriendo **≥8 tipos** de eventos. → los 14 eventos obligatorios + 2 extra; CP-32 lo comprueba
- [x] **[SEC-3]** Demostración de que la BD no tiene datos de tarjeta (`SELECT * FROM pagos;` solo `payment_intent_id`). → CP-28
- [ ] **[SEC-4]** Reporte **OWASP ZAP** contra la URL pública. → hecho contra local (`docs/zap/`, 0 FAIL); falta repetirlo contra la URL pública
- [x] **[SEC-5]** Hardening Docker: `docker ps` sin `0.0.0.0:3306` ni `0.0.0.0:6379`. → CP-14

---

## FASE 13 — Autoevaluación contra la rúbrica (15 pts)

**Técnicos (10 pts):** arquitectura 5+ servicios (1.5) · JWT Zero Trust (1.5) · flujo compra completo (2) · 3 APIs (1) · MariaDB replicación + Docker (2) · panel admin (1) · hosting nube (0.5) · diseño UX (0.5).

**Seguridad (5 pts):** OWASP ≥5–7 controles (2) · PCI-DSS 6 requisitos (1.5) · audit trail 14 eventos/30 registros (1) · BCP/DRP + ALE/ROSI (0.5).

**Penalizaciones a evitar:** retraso (-1/día) · monolito (-5) · sin pagos (-2) · sin Docker (-2) · sin repo (-2) · **keys en código (-4)** · **tarjeta en BD (-4)** · sin audit-service (-2) · mismo negocio que Proyecto 1 (-2) · plagio (0).

---

## FASE 14 — Cronograma (4 semanas)

| Semana | Técnico | Seguridad | Fecha |
|---|---|---|---|
| 1 | Negocio + docker-compose + auth-service | STRIDE + DFD + audit DB | 10 oct 2026 |
| 2 | catálogo (Cloudinary) + pedidos + Master-Slave | OWASP A01/A02/A03 + primeros audit logs | 17 oct 2026 |
| 3 | pagos (Stripe/PayPal) + notificaciones (EmailJS) + 3ra API + Redis | Webhook firma + hardening + ZAP 1ª corrida | 24 oct 2026 |
| 4 | Panel admin + hosting + compose producción + presentación | BCP/DRP + 30 logs + ALE/ROSI + demo recuperación | 31 oct 2026 |

---

## FASE 15 — Módulos de la veterinaria (extra, 16 de octubre de 2026)

Hoy la tienda es real pero el formulario «Reservar cita» de Inicio y Contacto no guarda nada (`BookingForm.jsx` solo hace `console.info`). Esta fase convierte la parte de servicios en un sistema de verdad, con los mismos controles que la tienda.

**Supuestos (corregir si no van):**
- Un microservicio nuevo, **`citas-service`** (PHP 8.3, puerto 8087 interno, base `citas_db` con su propio usuario). Llevaría la arquitectura a 7 microservicios.
- El admin hace también de veterinario. No se agrega un rol nuevo, porque el enunciado fija el ENUM `admin, cliente, anonimo` en la bitácora.
- Horario de lunes a sábado de 8:00 a 20:00, en turnos de 30 min. **2 cupos por turno y sede** (dos consultorios o dos cuidadores).
- Cada servicio se presta en su sede: consulta, vacunación y peluquería en Centro; guardería y hospedaje en Norte; paseos y entrenamiento en Sur.
- Las citas no se cobran en línea: se pagan en la sede. Así no se toca PCI-DSS.
- Correos con EmailJS usando una segunda plantilla (`EMAILJS_TEMPLATE_CITA_ID`). Sin ella se audita `EMAIL_ENVIADO` con FALLO, igual que hoy.

| Paso | Qué se entrega | Seguridad |
|---|---|---|
| **A1** ✅ citas-service (backend) | Tablas `mascotas`, `servicios`, `citas` y `turnos_bloqueados`. API: disponibilidad pública por sede, servicio y fecha; CRUD de *mis mascotas*; crear cita, ver *mis citas* y cancelar (hasta 2 h antes); en admin, agenda del día y cambio de estado (`pendiente → confirmada → atendida`, `no_asistio`, `cancelada`). Se suma al gateway, al Compose (hardening, healthcheck y límites) y a `generar-env.sh` | A01: el dueño sale del JWT en cada consulta. Sin doble reserva por condición de carrera: `UNIQUE (sede, inicio, cupo)`. Auditoría: `MASCOTA_REGISTRADA`, `CITA_CREADA`, `CITA_CANCELADA`, `CITA_ESTADO_CAMBIADO`. Rate limit propio. Pruebas CP-37… |
| **A2** ✅ Reserva real (frontend) | `BookingForm` conectado: elige servicio (la sede sale del servicio) → día → turno libre → mascota. Si no hay sesión, pide entrar o registrarse y al volver conserva lo elegido. «Reservar» en `/servicios` llega con el servicio ya elegido. Páginas `/cuenta/mascotas` (alta, edición y baja) y `/cuenta/citas` (próximas, historial y cancelar) | Validación en el servidor; el formulario solo ayuda. Si otro cliente gana el turno (409), se recargan los horarios |
| **A3** Agenda del admin + correo | Pestaña *Agenda* en el panel: citas del día por sede, cambio de estado y bloqueo de turnos (feriados, mantenimiento). Correo de confirmación de la cita con código HMAC, como el comprobante de pedido. Tarjeta «Citas de hoy» en el resumen | `ACCESO_ADMIN_PANEL` ya cubre la entrada; cada cambio de estado se audita con `dato_anterior`/`dato_nuevo` |
| **B1** Historial clínico y carné de vacunas | Al marcar una consulta como `atendida`, el admin registra el peso, el diagnóstico, el tratamiento y las vacunas aplicadas con la fecha de la próxima dosis. El cliente ve el **carné de vacunas** de su mascota (solo lectura) | Datos de salud = datos personales (A.5.34): solo el dueño y el admin. Se audita `HISTORIAL_REGISTRADO` y `HISTORIAL_CONSULTADO` (lectura del admin) |
| **C1** Recordatorios | Tarea periódica `citas-recordatorios` (como `pedidos-vencimientos`): un día antes manda el recordatorio de la cita, avisa 7 días antes de que venza una vacuna y marca `no_asistio` las citas pasadas sin atender | Auditoría `RECORDATORIO_ENVIADO`. Healthcheck por último ciclo correcto |
| **D1** Documentación | STRIDE/DFD con el flujo de citas, tabla OWASP, BIA (`citas-service` con criticidad ALTA, RTO 30 min y RPO 5 min), respaldos con `citas_db`, README, `usuarios.md`, guion de la presentación y PDF SEC-1 | — |

Como en las fases anteriores: un commit por paso, `tests/seguridad.sh` y el CI en verde antes de seguir. **En la base de desarrollo**, `citas_db` necesita volúmenes nuevos de master y slave (los init SQL solo corren la primera vez) o aplicar `db/master/07-citas_db.sql` a mano en el master; la réplica la copia sola.

---

## Recursos recomendados

- Docker Compose: https://docs.docker.com/compose
- Nginx: https://nginx.org/en/docs
- MariaDB Replication: https://mariadb.com/kb/en/replication
- Stripe Webhooks PHP: https://stripe.com/docs/webhooks
- Redis en PHP: https://github.com/phpredis/phpredis
- Render Docker: https://render.com/docs/docker
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- OWASP ZAP: https://www.zaproxy.org
- PCI-DSS v4.0: https://www.pcisecuritystandards.org
- STRIDE: https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool
- Let's Encrypt: https://letsencrypt.org
- Cloudflare: https://www.cloudflare.com
- ISO 27001:2022: https://www.iso.org/standard/82875.html

**Consultas:** erolandolx@gmail.com

---

## Dónde nos quedamos (17 de octubre de 2026)

- **FASE 15 en curso:** A1 (`citas-service`, CP-37 a CP-41) y A2 (reserva real en el frontend, `/cuenta/citas` y `/cuenta/mascotas`) hechos; 203 pruebas en verde. Sigue **A3** (agenda del admin y correo de la cita). Quien ya tenía el stack levantado corre `ops/migrar-citas.sh` antes de `docker compose up -d --build`.
- **Antes:** PDF SEC-1 regenerado (ya dice Semgrep CE), clima en el panel admin (OpenWeatherMap, con Open-Meteo de respaldo sin clave; CP-36) y gráfica de ventas con Chart.js, como pide la rúbrica (criterio 6). `tests/seguridad.sh` en verde.
- **Enunciado:** `instrucciones.docx` es el original del catedrático. Se comparó con este archivo y no trae requisitos nuevos.
- **Lo siguiente, en este orden:**
  1. **Claves sandbox** de Stripe, PayPal y EmailJS en el `.env` (pendientes 3–5). Se pueden probar en local antes de desplegar.
  2. **Repo privado:** AxER1402 cambia la visibilidad (pendiente 7). Si pasa antes del despliegue, `ops/vps/1-levantar.sh` necesita `REPO=git@github.com:AxER1402/Veterinaria.git` y una deploy key de solo lectura en el servidor.
  3. Ensayar la presentación (pendiente 9).
  4. **Al final, cuando se decida el dominio** (todavía no está decidido):
     1. Despliegue público (pendiente 1): registro DNS `A` hacia el servidor y `ops/vps/1-levantar.sh`, `2-nginx-http.sh` y `3-nginx-https.sh` con `DOMINIO=<el elegido>`.
     2. ZAP contra el dominio (pendiente 2, SEC-4).
     3. Volver a generar el PDF SEC-1 (`docs/pdf/construir.mjs`) para que lleve el ZAP del dominio.
     4. En producción: MFA del admin (pendiente 12), contraseña nueva de `admin@huellitas.gt` y cron de respaldos.
- **Para el compañero que jala los cambios:** `ops/generar-env.sh` → `docker compose up -d --build --wait` → `tests/seguridad.sh`. Los usuarios están en `usuarios.md`.
- **Entrega:** 31 de octubre de 2026 (-1 pt por día de retraso).

## Pendientes (al 10 de octubre de 2026)

Las 4 semanas del cronograma están implementadas y subidas, más extras: recuperación a un punto en el tiempo con binlogs, vencimiento de pedidos sin pagar, verificación en dos pasos (TOTP) y CI en GitHub Actions. `tests/seguridad.sh` pasa 162 de 162 (16 de octubre). Falta lo que depende de decisiones o cuentas externas:

| # | Pendiente | Qué hace falta | Afecta |
|---|---|---|---|
| 1 | **Desplegar en una URL pública** | Propuesta lista para el VPS 31.220.50.103 (detrás del Nginx del SGA, como FadeApp): elegir el dominio (sin decidir), crear su registro DNS y pegar `ops/vps/1-levantar.sh`, `2-nginx-http.sh` y `3-nginx-https.sh` (docs/07-despliegue.md §2c). Antes, confirmar dominio y RAM libre del VPS | Hosting en la nube (0.5 pts), URL pública y URL del panel admin |
| 2 | **ZAP contra la URL pública** | Correr `zap-baseline.py` contra el dominio una vez desplegado (comando en `docs/07-despliegue.md` §3) | SEC-4 |
| 3 | **Claves sandbox de Stripe** | `STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` (con `stripe listen` en local o el webhook del panel en producción) en `.env` | Pago real con la tarjeta 4242 en la demo |
| 4 | **Claves sandbox de PayPal** | `PAYPAL_CLIENT_ID` y `PAYPAL_CLIENT_SECRET` en `.env` | Botón de PayPal en la demo |
| 5 | **EmailJS** | `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY` y `EMAILJS_PRIVATE_KEY`, y activar "Allow EmailJS API for non-browser applications". La plantilla usa `to_email`, `to_name`, `pedido`, `total`, `productos`, `entrega`, `metodo_pago`, `referencia_pago` y `codigo_verificacion` | Correo de confirmación (hoy queda `EMAIL_ENVIADO` con FALLO por «no configurado») |
| 6 | **Cloudinary y Google Maps (opcional)** | `CLOUDINARY_*` y `GOOGLE_MAPS_EMBED_KEY`. Sin ellos funcionan los respaldos: imágenes desde Unsplash y el mapa embebido básico | CDN de imágenes, upload firmado del admin |
| 7 | **Repositorio privado** | AxER1402 debe cambiar la visibilidad de `AxER1402/Veterinaria` (Settings → Danger Zone). La cuenta Hugoda23 solo tiene permiso de escritura | Penalización «sin repo privado» |
| 8 | **Mapas en un navegador real** | Abrir `/contacto` y confirmar que se dibujan los mapas (en Chromium headless solo carga el marco) | Detalle visual |
| 9 | **Presentación de 10 min** | Ensayar con el guion de `docs/08-guion-presentacion.md` (ya escrito). Sin claves de Stripe, el pago se demuestra con el webhook firmado (CP-26) | Presentación |
| 10 | ~~**CI en GitHub**~~ ✅ | En verde desde `d75c1a4`: frontend, PHP/secretos y stack completo con 158 pruebas + simulacro DRP en un runner limpio. Solo hay que mantenerlo verde | — |
| 11 | ~~**SAST**~~ ✅ | Semgrep CE en el CI (job `sast`, `p/php` + `p/javascript` + `p/secrets`): 0 hallazgos. Los 3 hashes bcrypt intencionales (seed de prueba y señuelo antienumeración) llevan `nosemgrep` justificado | — |
| 12 | **Activar MFA en el admin** | Entrar con `admin@huellitas.gt` → aviso del panel → *Activar ahora* y escanear el QR. Hacerlo en producción, no en el seed de desarrollo, porque las pruebas automáticas usan el admin sin MFA | Riesgo «credenciales admin comprometidas» |

Al desplegar: secretos nuevos (no los de desarrollo), cambiar la contraseña de `admin@huellitas.gt`, instalar el cron de respaldos (`docs/04-bcp-drp.md` §3) y correr `tests/seguridad.sh` contra el dominio.

