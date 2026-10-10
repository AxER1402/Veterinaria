# Usuarios de Huellitas

## Aplicación (tienda y panel)

Se crean con el seed `db/master/02-auth_db.sql` cada vez que se levanta el stack con volúmenes nuevos. En la BD solo se guarda el hash bcrypt (cost 12).

| Rol | Correo | Contraseña | Dónde entra |
|---|---|---|---|
| Admin | `admin@huellitas.gt` | `Admin#2026` | `/admin` (panel) y la tienda |
| Cliente | `cliente@huellitas.gt` | `Cliente#2026` | `/tienda`, carrito, checkout y `/cuenta/pedidos` |

- **Clientes nuevos:** cualquiera puede registrarse en `/cuenta` (pestaña de registro; API `POST /api/auth/registro`). El registro siempre crea el rol `cliente`; un admin solo se crea desde la BD.
- **Bloqueo:** 5 contraseñas incorrectas bloquean la cuenta 15 min (A07). Si te bloqueas probando, espera o reinicia con volúmenes nuevos.
- **MFA (TOTP):** opcional por usuario, en `/cuenta/seguridad` (al admin el panel le muestra el aviso → *Activar ahora*). En desarrollo **no** se activa en `admin@huellitas.gt` porque `tests/seguridad.sh` y `ops/simulacro-drp.sh` entran con él sin segundo paso.
- **Producción:** estas contraseñas son públicas (están en el repo). Al desplegar hay que cambiar la del admin, activarle el MFA y no anotar la nueva aquí.

### Correos que crean las pruebas

`tests/seguridad.sh` usa estos correos para los casos de ataque (no son cuentas para la demo): `debil@correo.gt`, `flood@correo.gt`, `noexiste@correo.gt`, `sqli@correo.gt`, `xss@correo.gt`.

## Base de datos y Redis (internos)

Ninguno es accesible desde fuera de la red Docker. Las contraseñas **no** están en el repo: `ops/generar-env.sh` las genera al azar en `.env` (permisos 600, en `.gitignore`).

| Usuario | Permisos | Variable del `.env` |
|---|---|---|
| `root` (maestro y réplica) | todo | `DB_ROOT_PASSWORD` |
| `replicador` | replicación maestro → réplica | `DB_REPLICATION_PASSWORD` |
| `auth_user` | `SELECT/INSERT/UPDATE/DELETE` solo en `auth_db` | `AUTH_DB_PASSWORD` |
| `catalogo_user` | ídem solo en `catalogo_db` | `CATALOGO_DB_PASSWORD` |
| `pedidos_user` | ídem solo en `pedidos_db` | `PEDIDOS_DB_PASSWORD` |
| `pagos_user` | `SELECT/INSERT/UPDATE` en `pagos_db` (sin `DELETE`) | `PAGOS_DB_PASSWORD` |
| `root` (BD de auditoría) | todo en `audit_db` | `AUDIT_DB_ROOT_PASSWORD` |
| `audit_user` | `SELECT/INSERT` solo en `security_audit_logs` (append-only) | `AUDIT_DB_PASSWORD` |
| Redis | — | `REDIS_PASSWORD` |

Para ver las tuyas: `grep PASSWORD .env`. Cada quien tiene las suyas; no se comparten por el repo.
