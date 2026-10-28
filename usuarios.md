# Usuarios de Huellitas

## Aplicación (tienda y panel)

Se crean con el seed `db/master/02-auth_db.sql` cada vez que se levanta el stack con volúmenes nuevos. En la BD solo se guarda el hash bcrypt (cost 12).

| Rol | Correo | Contraseña | Dónde entra |
|---|---|---|---|
| Admin | `admin@huellitas.gt` | `Admin#2026` | `/admin` (panel) y la tienda |
| Veterinario | `veterinaria@huellitas.gt` | `Personal#2026` | Panel: Hoy, Agenda, Pacientes (historial clínico) y Clientes |
| Recepción | `recepcion@huellitas.gt` | `Personal#2026` | Panel: Hoy, Agenda y Clientes (sin historial clínico) |
| Tienda | `tienda@huellitas.gt` | `Personal#2026` | Panel: Hoy, Clientes, Pedidos y Catálogo |
| Cliente | `cliente@huellitas.gt` | `Cliente#2026` | `/tienda`, carrito, checkout, `/cuenta/pedidos`, `/cuenta/citas` y `/cuenta/mascotas` (reservar en `/reservar`) |

Las tres cuentas del personal las crea `db/master/13-roles-telefono.sql` (en un entorno ya levantado: `ops/migrar-v2.sh`). El admin puede dar o quitar roles desde **Clientes → Personal y roles** o desde la ficha de un cliente; cada cambio queda como `ROL_CAMBIADO` y rige en el siguiente inicio de sesión.

**Datos de demostración** (`ops/seed-demo.sh`, no se cargan solos). La cuenta de arriba pasa a ser *Lucía Hernández Pineda*, con 2 mascotas, 5 citas y 4 pedidos. Además se crean estas cuentas, todas con la contraseña `Cliente#2026`. Usan `@example.com`, un dominio reservado, para que los correos de la app no le lleguen a nadie real:

| Cliente | Correo | Qué tiene |
|---|---|---|
| María José López Castillo | `mariajose.lopez@example.com` | Luna (vacunas por vencer y cita de refuerzo) y Michi; un pedido con `FLASH50` |
| Carlos Enrique Méndez Ruiz | `carlos.mendez@example.com` | Rocky (vacunas vencidas); un pedido cancelado con tarjeta rechazada |
| Ana Lucía Pérez Morales | `analucia.perez@example.com` | Canela y Nube; retiro en la sede Norte |
| José Roberto García Aldana | `jroberto.garcia@example.com` | Max y Kiara (esquema de cachorra completo); pedido pagado con `HUELLITAS10` |
| Gabriela Fernanda Ramírez Soto | `gabriela.ramirez@example.com` | Toby (dermatitis y soplo, en control) |
| Diego Alejandro Morales Chávez | `diego.morales@example.com` | Coco, un conejo |
| Sofía Valentina Cifuentes Rivas | `sofia.cifuentes@example.com` | Pelusa y Thor; pedido pagado hace unas horas |

La demo también carga 14 reseñas publicadas (`db/seeds/02-resenas.sql`), escritas por estos clientes sobre productos de pedidos entregados. La consulta veterinaria tiene dos profesionales: la **Dra. Andrea Morales** (cuenta `veterinaria@huellitas.gt`) y el **Dr. Luis Pérez**; el horario de cada uno se edita en **Agenda → Equipo y horarios**.

- **Clientes nuevos:** cualquiera puede registrarse en `/cuenta` (pestaña de registro; API `POST /api/auth/registro`). El registro siempre crea el rol `cliente`; los roles del personal los asigna un admin desde el panel.
- **Bloqueo:** 5 contraseñas incorrectas bloquean la cuenta 15 min (A07). Si te bloqueas probando, espera o reinicia con volúmenes nuevos.
- **MFA (TOTP):** opcional por usuario, en `/cuenta/seguridad` (al admin el panel le muestra el aviso → *Activar ahora*). En desarrollo **no** se activa en `admin@huellitas.gt` porque `tests/seguridad.sh` y `ops/simulacro-drp.sh` entran con él sin segundo paso.
- **Producción:** estas contraseñas son públicas (están en el repo). Al desplegar hay que cambiar la del admin, activarle el MFA y no anotar la nueva aquí.

### Correos que crean las pruebas

`tests/seguridad.sh` usa estos correos para los casos de ataque (no son cuentas para la demo): `debil@correo.gt`, `flood@correo.gt`, `noexiste@correo.gt`, `sqli@correo.gt`, `xss@correo.gt`.

Además, cada corrida crea cuentas con un sufijo al azar: `compras<n>@correo.gt` (pedidos y la mayoría de las citas) y `citas<n>@correo.gt` (el segundo cliente de las pruebas de citas, CP-37 a CP-46). `ops/simulacro-drp.sh` registra `simulacro<n>@correo.gt` para comprobar que un cambio posterior al respaldo se recupera.

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
| `citas_user` | `SELECT/INSERT/UPDATE` en `citas_db` (sin `DELETE`: mascotas y citas se desactivan o cancelan) | `CITAS_DB_PASSWORD` |
| `root` (BD de auditoría) | todo en `audit_db` | `AUDIT_DB_ROOT_PASSWORD` |
| `audit_user` | `SELECT/INSERT` solo en `security_audit_logs` (append-only) | `AUDIT_DB_PASSWORD` |
| Redis | — | `REDIS_PASSWORD` |

Para ver las tuyas: `grep PASSWORD .env`. Cada quien tiene las suyas; no se comparten por el repo.
