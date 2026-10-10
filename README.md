# Huellitas — E-Commerce distribuido con seguridad y auditoría

Tienda en línea de productos para mascotas de la veterinaria *Huellitas*. La arquitectura es de microservicios, con controles OWASP Top 10, bitácora de seguridad append-only y Zero Trust entre servicios.
Proyecto 2 del curso **Auditoría y Seguridad de Sistemas**.

- Arquitectura, DFD y STRIDE: [`docs/01-arquitectura-stride-dfd.md`](docs/01-arquitectura-stride-dfd.md)
- Controles OWASP Top 10 con referencias al código: [`docs/02-owasp-top10.md`](docs/02-owasp-top10.md)
- Pagos y PCI-DSS: [`docs/03-pci-dss-pagos.md`](docs/03-pci-dss-pagos.md)
- Reportes de OWASP ZAP: [`docs/zap/`](docs/zap/)

## Servicios

| Servicio | Qué hace | Puerto |
|---|---|---|
| `gateway` | Nginx: única entrada. Usa TLS 1.3, WAF y rate limiting, y sirve el frontend React | host 8088 (HTTP→HTTPS) y 8443 |
| `auth-service` | Registro, login, JWT (1 h), logout con lista negra en Redis, bloqueo tras 5 intentos | 8081 (interno) |
| `catalogo-service` | 24 productos con variantes, precio y stock. Lecturas en la réplica con caché Redis; imágenes por Cloudinary | 8082 (interno) |
| `pedidos-service` | Pedidos con UUID, total calculado en el servidor, cupones, estados con historial | 8083 (interno) |
| `pagos-service` | Stripe (PaymentIntent + webhook firmado) y PayPal (Orders v2, captura en servidor). Sin datos de tarjeta | 8084 (interno; solo el webhook es público) |
| `notificaciones-service` | Correo de confirmación por EmailJS con código de verificación HMAC | 8085 (interno) |
| `security-audit-service` | Bitácora `security_audit_logs`: append-only, con cadena de hashes | 8086 (interno) |
| `mariadb-master` / `mariadb-slave` | BD de negocio (una por servicio) con réplica de solo lectura | interno |
| `mariadb-audit` | `audit_db` en una instancia y un volumen aparte | interno |
| `redis` | JWT revocados, contadores de rate limit y caché | interno |

APIs externas: **Stripe**, **PayPal**, **EmailJS**, **Cloudinary** y **Google Maps Embed**. Sus claves van en `.env`. Sin ellas, cada pasarela responde «no habilitado en este entorno» y el resto de la tienda funciona igual.

## Levantar

```bash
cp .env.example .env      # rellenar los secretos (el comando para generarlos está dentro del archivo)
docker compose up -d --build
```

Abrir <https://localhost:8443>. En local el certificado es autofirmado y se genera solo. En producción se monta el de Let's Encrypt en `gateway/certs/`.

### Usuarios de prueba

| Rol | Correo | Contraseña |
|---|---|---|
| Admin | `admin@huellitas.gt` | `Admin#2026` |
| Cliente | `cliente@huellitas.gt` | `Cliente#2026` |

## API (vía gateway)

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/auth/registro` | público. Crea siempre rol `cliente` |
| POST | `/api/auth/login` | público, con rate limit |
| POST | `/api/auth/logout` | usuario. Revoca el JWT |
| GET | `/api/auth/me` | usuario |
| POST | `/api/auth/admin/acceso` | admin. Registra `ACCESO_ADMIN_PANEL` |
| GET | `/api/catalogo/productos` · `/api/catalogo/productos/{slug}` | público, con caché |
| GET/PATCH | `/api/catalogo/admin/productos[/{id}]` · `PATCH /api/catalogo/admin/variantes/{id}` | admin. Precio y stock auditados |
| POST | `/api/catalogo/admin/imagenes/firma` | admin. Upload firmado a Cloudinary |
| GET | `/api/pedidos/sedes` · `/api/pedidos/cupones/{codigo}` | público |
| POST | `/api/pedidos/cotizar` | público. Total autoritativo del carrito |
| POST/GET | `/api/pedidos` · `GET /api/pedidos/{uuid}` | cliente. Solo sus pedidos |
| POST | `/api/pedidos/{uuid}/pago` `{metodo: stripe\|paypal}` · `/api/pedidos/{uuid}/pago/paypal/capturar` | cliente dueño del pedido |
| POST | `/api/pagos/webhook/stripe` | Stripe. Requiere `Stripe-Signature` válida |
| GET | `/api/pedidos/admin/todos` · `PATCH /api/pedidos/admin/{uuid}/estado` | admin |
| GET | `/api/auditoria/eventos?accion=&resultado=&servicio=&usuario_email=&desde=&hasta=&limite=&pagina=` | admin |
| GET | `/api/auditoria/resumen` | admin |
| GET | `/api/auditoria/integridad` | admin. Verifica la cadena de hashes |

`/internal/*` es solo para la comunicación entre servicios y el gateway nunca lo publica.

## Pruebas de seguridad

```bash
tests/seguridad.sh
```

Corre los casos CP-01 a CP-30 contra el stack levantado: TLS 1.3, cabeceras, JWT manipulado, bloqueo de cuenta, logout, WAF, Zero Trust entre servicios, bitácora append-only, puertos de BD/Redis no expuestos, contenedores sin root, replicación, precios manipulados, acceso a pedidos ajenos (A01), stock, eventos de auditoría, webhook de Stripe (firma, replay, monto manipulado), ausencia de datos de tarjeta, rutas de pago internas y secretos fuera del repo.

> La ráfaga del CP-16 agota el cupo de `/login` del gateway. Si se repite la prueba, conviene esperar ~30 s.

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
  notificaciones/    notificaciones-service (EmailJS)
  audit/             security-audit-service
db/master/           usuarios por servicio + esquemas y datos de auth_db, catalogo_db (24 productos), pedidos_db, pagos_db
db/audit/            audit_db: tabla, triggers append-only, usuario INSERT/SELECT
docs/                arquitectura, DFD, STRIDE (y luego OWASP, PCI-DSS, BCP/DRP, ALE/ROSI)
tests/seguridad.sh   pruebas end-to-end de los controles
```
