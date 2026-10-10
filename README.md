# Huellitas — E-Commerce distribuido con seguridad y auditoría

Tienda en línea de productos para mascotas de la veterinaria *Huellitas*. La arquitectura es de microservicios, con controles OWASP Top 10, bitácora de seguridad append-only y Zero Trust entre servicios.
Proyecto 2 del curso **Auditoría y Seguridad de Sistemas**.

- Arquitectura, DFD y STRIDE: [`docs/01-arquitectura-stride-dfd.md`](docs/01-arquitectura-stride-dfd.md)

## Servicios

| Servicio | Qué hace | Puerto |
|---|---|---|
| `gateway` | Nginx: única entrada. Usa TLS 1.3, WAF y rate limiting, y sirve el frontend React | host 8088 (HTTP→HTTPS) y 8443 |
| `auth-service` | Registro, login, JWT (1 h), logout con lista negra en Redis, bloqueo tras 5 intentos | 8081 (interno) |
| `security-audit-service` | Bitácora `security_audit_logs`: append-only, con cadena de hashes | 8086 (interno) |
| `mariadb-master` / `mariadb-slave` | BD de negocio (una por servicio) con réplica de solo lectura | interno |
| `mariadb-audit` | `audit_db` en una instancia y un volumen aparte | interno |
| `redis` | JWT revocados, contadores de rate limit y caché | interno |

`catalogo-service`, `pedidos-service`, `pagos-service` y `notificaciones-service` se agregan en las semanas 2 y 3 (ver `implementacion.md`).

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
| GET | `/api/auditoria/eventos?accion=&resultado=&servicio=&usuario_email=&desde=&hasta=&limite=&pagina=` | admin |
| GET | `/api/auditoria/resumen` | admin |
| GET | `/api/auditoria/integridad` | admin. Verifica la cadena de hashes |

`/internal/*` es solo para la comunicación entre servicios y el gateway nunca lo publica.

## Pruebas de seguridad

```bash
tests/seguridad.sh
```

Corre los casos CP-01 a CP-16 contra el stack levantado: TLS 1.3, cabeceras, JWT manipulado, bloqueo de cuenta, logout, WAF, Zero Trust entre servicios, bitácora append-only, puertos de BD/Redis no expuestos, contenedores sin root y replicación.

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
  audit/             security-audit-service
db/master/           auth_db, catalogo_db, pedidos_db, pagos_db + usuarios por servicio
db/audit/            audit_db: tabla, triggers append-only, usuario INSERT/SELECT
docs/                arquitectura, DFD, STRIDE (y luego OWASP, PCI-DSS, BCP/DRP, ALE/ROSI)
tests/seguridad.sh   pruebas end-to-end de los controles
```
