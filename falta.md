
Cómo actualizar un entorno ya levantado
- Si el entorno se levantó cuando los precios estaban en dólares (la moneda por defecto de `pagos_db.pagos` es `USD`), correr primero `ops/backup.sh` y `ops/migrar-quetzales.sh`. `migrar-v2.sh` no lo incluye. Sin esto el webhook de Stripe rechaza los pagos en quetzales.
- Correr `ops/migrar-v2.sh` y después `docker compose up -d --build --wait`. El script aplica, sin borrar datos, las migraciones `db/master/12` a `22` y `db/audit/02`, y se puede correr más de una vez.
- Datos de demostración: `ops/seed-demo.sh`. Carga clientes, mascotas, citas, historial, pedidos y 14 reseñas coherentes con los pedidos entregados. No borra nada y se puede repetir.
- Variables nuevas o cambiadas en el `.env` (ver `.env.example`):
  - `PEDIDO_VENCE_HORAS=2`: antes era 24.
  - `CLOUDINARY_FETCH`: opcional, 0 por defecto. Ya está activo en local.
  - `DB_MAX_RETRASO_SEG`: opcional, 5 por defecto.
  - `STRIPE_OCULTAR_TARJETA`: opcional, 0 por defecto. Con 1 la tienda no ofrece tarjeta, pero Stripe sigue configurado.
  - `PAYPAL_TIPO_CAMBIO_AUTO`: opcional, 1 por defecto (tipo de cambio del Banguat). `PAYPAL_TIPO_CAMBIO` queda de respaldo.
- Cuentas del personal para probar cada rol (veterinario, recepción, tienda): están en `usuarios.md`, todas con la contraseña `Personal#2026`.

Pendiente
- Pagos (apartado 13):
  - Ya hecho: el checkout solo ofrece los métodos con claves, el texto sobre la tarjeta se corrigió y existe el reembolso por API. El 2026-10-29 se agregaron `STRIPE_OCULTAR_TARJETA`, `disable-funding=card`, la revisión de la CSP, el aviso al cerrar PayPal y el tipo de cambio automático del Banguat (ver `implementacionfaltante.md`).
  - Faltan las claves de prueba (sandbox) de PayPal y Stripe en el `.env`. Sin ellas no se puede pagar en línea ni reembolsar por la pasarela; el panel lo dice y permite registrar el reembolso a mano. El flujo de PayPal se probó con el SDK y el `client-id=test` público, no con una cuenta propia.
- Fotos de productos: siguen siendo de stock. La subida funciona desde Catálogo → Editar; falta cargar las fotos reales.
- Equipo por servicio (2026-10-29): la demo ya trae personal en todos los servicios por turnos (`db/seeds/03-profesionales.sql`). Los nombres y horarios son de ejemplo: falta cargar el equipo real desde **Agenda → Equipo y horarios**. Ojo: si desde el panel se agrega la primera persona a un servicio que todavía usa lugares fijos, las citas que ya existen no se le asignan solas. Hoy no queda ningún servicio por turnos en esa situación, pero aplicaría a uno nuevo; el seed muestra cómo reasignarlas.
- Contenido por confirmar con el negocio:
  - "Envío el mismo día" (en la tienda) y "Devoluciones gratis durante 30 días" (en la página de producto).
  - Privacidad (`/privacidad`) y Términos (`/terminos`) ya existen (2026-10-29) y describen lo que hace el sistema, pero son un texto base: falta que el negocio confirme la política de cambios y devoluciones y los motivos para ocultar reseñas, y que lo revise alguien con criterio legal. Las cifras (horario, 60 días, 2 h, Q35/Q400, 3 faltas) salen del código: si cambian allá, cambiarlas también en `Terminos.jsx`.
  - FLASH50 no tiene fecha de vencimiento en la base, así que no se muestra cuenta regresiva. Si se quiere, hay que poner la fecha en `pedidos_db.cupones.vence`.
  - Los testimonios y las reseñas son de demostración: ficticios pero coherentes con los clientes de la demo.
- En el servidor hay que correr `ops/reparar-replica.sh` para resolver el error 1236 (se probó en local). Usar la versión del 2026-10-30 o posterior: la anterior deja la réplica `unhealthy` en el siguiente reinicio (ver `implementacionfaltante.md`).
- Vacunas en guardería y hospedaje: la reserva no las valida. Términos pide traer el carné al día (como la FAQ); falta que el negocio decida si basta con revisarlo en la sede o si el sistema debe exigirlo.
- macOS con Docker Desktop (corregido el 2026-10-29): los scripts de inicio de la base fallaban porque el bind mount los mostraba como ejecutables, y las bases quedaban vacías aunque el contenedor estuviera «healthy». Ahora `db/iniciar-mariadb.sh` los copia con permisos 644 antes de arrancar. Confirmado el 2026-10-30 en una Mac real con volúmenes nuevos. `.gitattributes` fuerza LF en `.sh` y `.sql` (para Windows).

Lo que no se probó
- Revisión en el navegador (2026-10-29, Chromium sin interfaz): 37 pantallas por rol (cliente, admin, veterinario, recepción, tienda y cliente con contraseña temporal), en escritorio (1366 px) y celular (390 px), sin errores de JS, sin peticiones fallidas y sin desborde horizontal. Se corrigieron el encabezado en celulares, las tablas sin desplazamiento, la sección fuera del rol y una petición prohibida de la tienda (ver `implementacionfaltante.md`). Falta probarlo en un teléfono real, y en Safari/iOS.
- El reembolso por la pasarela no se probó con un pago real: falta tener claves.
- `tests/seguridad.sh` se corrió el 2026-10-29 en local: 342 pasaron, 0 fallaron (detalle en `implementacionfaltante.md`). La prueba CP-36 necesita internet (clima). En macOS se corre con `tests/seguridad-en-contenedor.sh`: 342 de 342 el 2026-10-30.
- Los correos nuevos (cita reprogramada, cambios de estado de pedidos) reutilizan la plantilla de citas de EmailJS. No se probaron con claves reales.

Otros pendientes
- Docs (STRIDE, OWASP, ISO, PCI, BCP, guion, README) actualizados el 2026-10-29 con los roles del personal y los 38 eventos (catálogo en `docs/02-owasp-top10.md`, A09). Queda pendiente:
  - Los 38 eventos tienen prueba automática (CP-50 y CP-51 cubren los ocho que faltaban). `PAGO_REEMBOLSADO` con éxito sigue necesitando claves sandbox.
  - Decidido (2026-10-29): el `rol` de la bitácora se mantiene ampliado (`veterinario`, `recepcion`, `tienda`), aunque el enunciado dice `ENUM(admin,cliente,anonimo)`. La justificación está en `docs/08-guion-presentacion.md` (preguntas probables).
  - PDF SEC-1 regenerado el 2026-10-29 con los docs nuevos (27 páginas). Hay que volver a generarlo si cambian los docs o tras el ZAP contra el dominio.
- Panel con `lazy()` (2026-10-29): el bundle principal bajó de 540 a 377 KB y Vite ya no avisa. La tienda descarga 421 KB de JS en vez de 540, y nada del panel.
- Base local limpia (2026-10-29): solo la demo (12 usuarios, 13 mascotas, 42 citas, 13 pedidos, 14 reseñas), en quetzales. La bitácora se conservó. Respaldo previo: `backups/20261029-071659`. **Ojo:** `tests/seguridad.sh` vuelve a llenar la base de datos de prueba (clientes «compras…», mascotas «Firulais 123…», citas en los próximos 40 días). Decidido: en la presentación se muestra el CI en verde y no se corren las pruebas contra la base de la demo (`docs/08`). Para volver a limpiar: `ops/backup.sh`, borrar los volúmenes `huellitas_master_data`, `huellitas_slave_data` y `huellitas_redis_data` (no `audit_data`), `docker compose up -d --wait` y `ops/seed-demo.sh`.
