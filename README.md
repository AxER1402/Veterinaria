# Huellitas — E-Commerce distribuido con seguridad y auditoría

[![CI](https://github.com/AxER1402/Veterinaria/actions/workflows/ci.yml/badge.svg)](https://github.com/AxER1402/Veterinaria/actions/workflows/ci.yml)

Tienda en línea de productos para mascotas y sistema de citas de la veterinaria *Huellitas* (consultas, vacunas, peluquería, guardería, hospedaje, paseos y entrenamiento). La arquitectura es de microservicios, con controles OWASP Top 10, bitácora de seguridad append-only y Zero Trust entre servicios.
Proyecto 2 del curso **Auditoría y Seguridad de Sistemas**.

- Arquitectura, DFD y STRIDE: [`docs/01-arquitectura-stride-dfd.md`](docs/01-arquitectura-stride-dfd.md)
- Controles OWASP Top 10 con referencias al código: [`docs/02-owasp-top10.md`](docs/02-owasp-top10.md)
- Pagos y PCI-DSS: [`docs/03-pci-dss-pagos.md`](docs/03-pci-dss-pagos.md)
- Continuidad y recuperación (BCP/DRP): [`docs/04-bcp-drp.md`](docs/04-bcp-drp.md) · simulacros en [`docs/simulacros/`](docs/simulacros/)
- Presupuesto ALE/ROSI: [`docs/05-presupuesto-ale-rosi.md`](docs/05-presupuesto-ale-rosi.md) · ISO 27001: [`docs/06-iso27001.md`](docs/06-iso27001.md)
- Despliegue en producción: [`docs/07-despliegue.md`](docs/07-despliegue.md) · guion de la presentación: [`docs/08-guion-presentacion.md`](docs/08-guion-presentacion.md)
- Evidencia de SEC-2, SEC-3 y SEC-5 (salidas reales y capturas): [`docs/evidencia/`](docs/evidencia/) (se regenera con `ops/evidencia.sh`)
- Reportes de OWASP ZAP: [`docs/zap/`](docs/zap/)
- **SEC-1 en PDF:** [`docs/pdf/SEC-1-Huellitas-Seguridad.pdf`](docs/pdf/SEC-1-Huellitas-Seguridad.pdf)

## Entregables

| Entregable | Dónde |
|---|---|
| Tienda pública (catálogo sin registro) | `https://<dominio>/tienda` (local: <https://localhost:8443/tienda>) |
| Panel de administración | `/admin` con `admin@huellitas.gt` / `Admin#2026` |
| Reserva de citas | `/servicios` → «Reservar», o «Reservar cita» en el encabezado; el cliente ve `/cuenta/citas` y `/cuenta/mascotas` |
| Microservicios + compose + README | este repositorio (7 microservicios + gateway + 2 tareas periódicas + 3 BD + Redis) |
| Scripts SQL con ≥ 20 productos | `db/master/*.sql` (24 productos, 40 variantes), `db/audit/` |
| **SEC-1** PDF de seguridad | `docs/pdf/SEC-1-Huellitas-Seguridad.pdf` (se regenera con `docs/pdf/construir.mjs`) |
| **SEC-2** ≥ 30 registros, ≥ 8 tipos | `/admin/bitacora` o `GET /api/auditoria/resumen` (CP-32 lo comprueba: los 14 eventos obligatorios; hay 38 tipos en total, 13 del módulo de citas; catálogo en `docs/02-owasp-top10.md`, A09) |
| **SEC-3** sin datos de tarjeta | `SELECT * FROM pagos_db.pagos;` → solo `payment_intent_id` (CP-28) |
| **SEC-4** reporte OWASP ZAP | `docs/zap/zap-baseline-2.html` (0 FAIL, 0 alertas medias o altas) |
| **SEC-5** hardening Docker | `docker ps` → ningún `0.0.0.0:3306` ni `0.0.0.0:6379` (CP-14) |
| Demo de recuperación | `ops/simulacro-drp.sh` → informe en `docs/simulacros/` |
| Presentación de 10 min | `docs/08-guion-presentacion.md` (tiempos, comandos de la demo y preguntas probables) |

## Servicios

| Servicio | Qué hace | Puerto |
|---|---|---|
| `gateway` | Nginx: única entrada. Usa TLS 1.3, WAF y rate limiting, y sirve el frontend React | host 8088 (HTTP→HTTPS) y 8443 |
| `auth-service` | Registro, login, verificación en dos pasos (TOTP), JWT (1 h), logout con lista negra en Redis, bloqueo tras 5 intentos | 8081 (interno) |
| `catalogo-service` | 24 productos con variantes, precio y stock. Lecturas en la réplica con caché Redis; imágenes por Cloudinary | 8082 (interno) |
| `pedidos-service` | Pedidos con UUID, total calculado en el servidor, cupones, estados con historial | 8083 (interno) |
| `pedidos-vencimientos` | Tarea periódica (cada 15 min): cancela los pedidos sin pagar tras `PEDIDO_VENCE_HORAS` (24 h) y devuelve el stock | — |
| `citas-recordatorios` | Tarea periódica (cada 15 min): recordatorio de la cita un día antes, aviso 7 días antes de que venza una vacuna y cierre como «no asistió» de las citas que pasaron sin atenderse | — |
| `pagos-service` | Stripe (PaymentIntent + webhook firmado, cobra en quetzales) y PayPal (Orders v2, captura en servidor; cobra en US$ al tipo de cambio del día del Banguat, con `PAYPAL_TIPO_CAMBIO` de respaldo, porque no acepta GTQ). Sin datos de tarjeta | 8084 (interno; solo el webhook es público) |
| `notificaciones-service` | Correo de confirmación por EmailJS con código de verificación HMAC. Clima del panel admin (OpenWeatherMap u Open-Meteo) | 8085 (interno) |
| `citas-service` | Mascotas de cada cliente y citas por sede en turnos de 30 min (2 cupos). La BD impide la doble reserva; máx. 5 citas próximas por cliente. Agenda del admin, bloqueo de turnos, historial clínico y carné de vacunas | 8087 (interno) |
| `security-audit-service` | Bitácora `security_audit_logs`: append-only, con cadena de hashes | 8086 (interno) |
| `mariadb-master` / `mariadb-slave` | BD de negocio (una por servicio) con réplica de solo lectura | interno |
| `mariadb-audit` | `audit_db` en una instancia y un volumen aparte | interno |
| `redis` | JWT revocados, contadores de rate limit y caché | interno |

APIs externas: **Stripe**, **PayPal**, **EmailJS**, **Cloudinary**, **Google Maps Embed** y **OpenWeatherMap**. Sus claves van en `.env`. Sin ellas, cada pasarela responde «no habilitado en este entorno» y el resto de la tienda funciona igual. El clima del panel admin usa Open-Meteo, que no pide clave, mientras no haya `OPENWEATHER_API_KEY`.

## Levantar

```bash
ops/generar-env.sh        # .env con secretos aleatorios; las claves de Stripe/PayPal/EmailJS se agregan a mano
docker compose up -d --build
```

¿Ya lo tenías levantado antes del módulo de citas? Corre una vez `ops/migrar-citas.sh` (agrega `CITAS_DB_PASSWORD` al `.env` y crea `citas_db` sin borrar datos) y luego `docker compose up -d --build`.

¿Lo tenías levantado con precios en dólares? Corre una vez `ops/migrar-quetzales.sh` y luego `docker compose up -d --build`. Agrega `PAYPAL_TIPO_CAMBIO` al `.env`, convierte el catálogo y los servicios a quetzales y vuelve a valorar los pedidos que ya existían, sin borrar datos.

Abrir <https://localhost:8443>. En local el certificado es autofirmado y se genera solo. En producción se monta el de Let's Encrypt en `gateway/certs/`.

### Usuarios de prueba

| Rol | Correo | Contraseña |
|---|---|---|
| Admin | `admin@huellitas.gt` | `Admin#2026` |
| Cliente | `cliente@huellitas.gt` | `Cliente#2026` |

### Datos de demostración

`ops/seed-demo.sh` carga 7 clientes más con sus mascotas, citas pasadas, de hoy y futuras, historial clínico, carné de vacunas, pedidos en todos los estados y sus pagos, todo relacionado (`db/seeds/`). No borra nada y se puede correr otra vez. No va en la instalación porque sus citas ocupan turnos que usan las pruebas.

Todos los usuarios (app, BD y Redis) están en [`usuarios.md`](usuarios.md).

## API (vía gateway)

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/auth/registro` | público. Crea siempre rol `cliente` |
| POST | `/api/auth/login` | público, con rate limit |
| POST | `/api/auth/login/mfa` `{desafio, codigo}` | segundo paso del login cuando la cuenta tiene MFA |
| GET | `/api/auth/google/config` | público. ID de cliente del botón de Google (`null` si no está configurado) |
| POST | `/api/auth/google` `{credential}` | público, con rate limit. Entra o registra un cliente con el token de Google |
| POST | `/api/auth/mfa/configurar` · `/activar` · `/desactivar` | usuario. Verificación en dos pasos TOTP |
| POST | `/api/auth/logout` | usuario. Revoca el JWT |
| GET | `/api/auth/me` | usuario |
| POST | `/api/auth/admin/acceso` | admin. Registra `ACCESO_ADMIN_PANEL` |
| GET | `/api/catalogo/productos` · `/api/catalogo/productos/{slug}` | público, con caché |
| GET/POST/PATCH | `/api/catalogo/admin/productos[/{id}]` · `PATCH /api/catalogo/admin/variantes/{id}` | admin. Alta, precio y stock auditados |
| POST | `/api/catalogo/admin/imagenes/firma` | admin. Upload firmado a Cloudinary |
| GET | `/api/pedidos/sedes` · `/api/pedidos/cupones/{codigo}` | público |
| POST | `/api/pedidos/cotizar` | público. Total autoritativo del carrito |
| POST/GET | `/api/pedidos` · `GET /api/pedidos/{uuid}` | cliente. Solo sus pedidos |
| POST | `/api/pedidos/{uuid}/pago` `{metodo: stripe\|paypal}` · `/api/pedidos/{uuid}/pago/paypal/capturar` | cliente dueño del pedido |
| POST | `/api/pagos/webhook/stripe` | Stripe. Requiere `Stripe-Signature` válida |
| GET | `/api/pedidos/admin/todos` · `PATCH /api/pedidos/admin/{uuid}/estado` | admin |
| GET | `/api/pedidos/admin/clima` | admin. Clima de Ciudad de Guatemala, en caché 10 min |
| GET | `/api/citas/servicios` · `/api/citas/disponibilidad?servicio=&fecha=` | público |
| GET/POST | `/api/citas/mascotas` · `PATCH`/`DELETE /api/citas/mascotas/{uuid}` | cliente. Solo sus mascotas |
| GET | `/api/citas/mascotas/{uuid}/carne` | cliente dueño. Carné de vacunas, sin diagnósticos |
| GET/POST | `/api/citas` · `POST /api/citas/{uuid}/cancelar` | cliente. Solo sus citas; cancela hasta 2 h antes |
| GET | `/api/citas/admin/agenda?fecha=&sede=` · `PATCH /api/citas/admin/{uuid}/estado` | admin |
| GET/POST | `/api/citas/admin/bloqueos` · `DELETE /api/citas/admin/bloqueos/{id}` | admin. Feriados y mantenimiento; no se bloquea un turno con citas activas |
| POST | `/api/citas/admin/{uuid}/historial` · `GET /api/citas/admin/mascotas/{uuid}/historial` | admin. Consulta con peso, diagnóstico, tratamiento y vacunas; cada lectura se audita |
| GET | `/api/auditoria/eventos?accion=&resultado=&servicio=&usuario_email=&desde=&hasta=&limite=&pagina=` | admin |
| GET | `/api/auditoria/resumen` | admin |
| GET | `/api/auditoria/integridad` | admin. Verifica la cadena de hashes |

`/internal/*` es solo para la comunicación entre servicios y el gateway nunca lo publica.

## Pruebas de seguridad

```bash
tests/seguridad.sh                 # en Linux
tests/seguridad-en-contenedor.sh   # en macOS: la misma suite, en un contenedor Linux
```

Corre los casos CP-01 a CP-52 (373 comprobaciones) contra el stack levantado: TLS 1.3, cabeceras, JWT manipulado, bloqueo de cuenta, logout, WAF, Zero Trust entre servicios, bitácora append-only, puertos de BD/Redis no expuestos, contenedores sin root, replicación, precios manipulados, acceso a pedidos ajenos (A01), stock, eventos de auditoría, webhook de Stripe (firma, replay, monto o moneda manipulados), ausencia de datos de tarjeta, rutas de pago internas y secretos fuera del repo, exportación auditada, evidencia de SEC-2, vencimiento de pedidos sin pagar, verificación en dos pasos, IP del cliente no falsificable, clima del panel y el módulo de citas (mascotas y citas ajenas, doble reserva simultánea, agenda y estados, correo con código HMAC, bloqueos de turnos, historial clínico, carné de vacunas, recordatorios y límite de citas por cliente), el alta de productos desde el panel, el tipo de cambio de PayPal, los roles del personal (mínimo privilegio y cambios auditados), reembolsos, reseñas, reprogramación de citas, horarios del equipo, correcciones del historial e inicio de sesión con Google.

> La ráfaga del CP-16 agota el cupo de `/login` del gateway. Si se repite la prueba enseguida, la suite espera sola a que se recupere (hasta ~1 min).

## Panel de administración

`/admin` (solo rol admin; cada ingreso queda como `ACCESO_ADMIN_PANEL`):

- **Resumen:** ventas cobradas, pedidos pendientes, eventos de auditoría, integridad de la bitácora, clima de la ciudad y gráfica de ventas por día con Chart.js (con vista de tabla).
- **Pedidos:** filtro por estado y cambio de estado según las transiciones permitidas.
- **Agenda:** citas del día por sede, cambio de estado, bloqueo de turnos, *Registrar consulta* (peso, diagnóstico, tratamiento y vacunas) e historial de cada mascota. El resumen muestra la tarjeta «Citas de hoy».
- **Catálogo:** alta de productos con sus presentaciones (botón *Nuevo producto*; el slug y los SKU los pone el servidor y la imagen debe ser de Unsplash o de la cuenta de Cloudinary de la tienda), precio, precio anterior, stock, activo y destacado. Generan `PRODUCTO_CREADO`, `PRECIO_MODIFICADO` y `PRODUCTO_AGOTADO`.
- **Bitácora:** filtros, detalle con antes y después, y botón «Verificar integridad».
- **Clientes:** listado y exportación a CSV (`EXPORTACION_CLIENTES`).

## Respaldos y recuperación

```bash
ops/backup.sh                         # respaldo AES-256 de todas las bases → backups/<fecha>/
ops/backup-binlogs.sh                 # archiva los binlogs del maestro (cron cada 5 min → RPO ≤ 5 min)
ops/restore.sh backups/<fecha> negocio [--hasta "AAAA-MM-DD HH:MM:SS"]   # completo + binlogs (PITR)
ops/simulacro-drp.sh                  # simulacro de ransomware en el maestro, con informe y RTO medido (compara también citas e historial)
```

## Integración continua

`.github/workflows/ci.yml` corre en cada push y pull request:

1. **Frontend:** `npm ci`, lint, build y `npm audit` (falla con vulnerabilidades altas o críticas).
2. **PHP y secretos:** `php -l` de todos los servicios y búsqueda de claves o llaves privadas en archivos versionados.
3. **SAST:** Semgrep CE (`p/php`, `p/javascript`, `p/secrets`); falla con cualquier hallazgo. Los falsos positivos se justifican en línea con `nosemgrep: <regla> (motivo)`.
4. **Seguridad:** levanta el stack completo con un `.env` efímero (`ops/generar-env.sh`), corre `tests/seguridad.sh` y el simulacro DRP, y sube la evidencia como artefacto.

## Frontend en desarrollo

```bash
docker compose --profile dev up frontend-dev   # http://localhost:5173, /api pasa al gateway
```

O con Node 20+: `cd frontend && npm install && npm run dev`.

## Estructura

```
frontend/            React + Vite (tienda, carrito, checkout)
gateway/             Dockerfile + plantilla Nginx (WAF, TLS, rate limit, proxy)
services/
  Dockerfile         imagen PHP común (Apache en puerto alto, USER www-data)
  shared/            JWT, Guard (Zero Trust), Redis, PDO, validación, cliente de auditoría
  auth/              auth-service
  catalogo/          catalogo-service (catálogo, stock, Cloudinary)
  pedidos/           pedidos-service (pedidos, cupones, totales)
  pagos/             pagos-service (Stripe, PayPal, webhook)
  notificaciones/    notificaciones-service (EmailJS, clima)
  citas/             citas-service (mascotas, turnos, agenda)
  audit/             security-audit-service
db/master/           usuarios por servicio + esquemas y datos de auth_db, catalogo_db (24 productos), pedidos_db, pagos_db, citas_db
db/audit/            audit_db: tabla, triggers append-only, usuario INSERT/SELECT
db/seeds/            datos de demostración (ops/seed-demo.sh), fuera de la instalación
docs/                STRIDE/DFD, OWASP, PCI-DSS, BCP/DRP, ALE/ROSI, ISO 27001, despliegue, ZAP, PDF de SEC-1
ops/                 generar-env.sh, migrar-citas.sh, migrar-quetzales.sh, seed-demo.sh, backup.sh, backup-binlogs.sh, restore.sh, simulacro-drp.sh, evidencia.sh
.github/workflows/   CI: lint, build, npm audit, php -l, secretos, pruebas de seguridad y simulacro DRP
docker-compose.prod.yml  producción: puertos 80/443 y Let's Encrypt (certbot)
docker-compose.proxy.yml detrás del Nginx de otro sistema (VPS compartido); scripts en ops/vps/
tests/seguridad.sh   pruebas end-to-end de los controles
```
