
Cómo actualizar un entorno ya levantado
- Correr `ops/migrar-v2.sh` y después `docker compose up -d --build --wait`. El script aplica, sin borrar datos, las migraciones `db/master/12` a `22` y `db/audit/02`, y se puede correr más de una vez.
- Datos de demostración: `ops/seed-demo.sh`. Carga clientes, mascotas, citas, historial, pedidos y 14 reseñas coherentes con los pedidos entregados. No borra nada y se puede repetir.
- Variables nuevas o cambiadas en el `.env` (ver `.env.example`):
  - `PEDIDO_VENCE_HORAS=2`: antes era 24.
  - `CLOUDINARY_FETCH`: opcional, 0 por defecto. Ya está activo en local.
  - `DB_MAX_RETRASO_SEG`: opcional, 5 por defecto.
- Cuentas del personal para probar cada rol (veterinario, recepción, tienda): están en `usuarios.md`, todas con la contraseña `Personal#2026`.

Pendiente
- Pagos (apartado 13), sin hacer salvo lo indicado:
  - Ya hecho: el checkout solo ofrece los métodos con claves, el texto sobre la tarjeta se corrigió y existe el reembolso por API.
  - Faltan las claves de prueba (sandbox) de PayPal y Stripe en el `.env`. Sin ellas no se puede pagar en línea ni reembolsar por la pasarela; el panel lo dice y permite registrar el reembolso a mano.
  - Falta una opción para ocultar la tarjeta sin borrar Stripe, porque las pruebas CP-26 a CP-28 dependen de Stripe.
  - Falta `disable-funding=card` en el SDK de PayPal.
  - Falta comprobar si la política de seguridad del sitio (CSP) bloquea `*.paypalobjects.com`.
  - Falta un mensaje cuando el cliente cierra la ventana de PayPal.
  - Falta que el tipo de cambio se actualice solo.
- Fotos de productos: siguen siendo de stock. La subida funciona desde Catálogo → Editar; falta cargar las fotos reales.
- Equipo por servicio: solo la consulta veterinaria tiene profesionales cargados. Peluquería, paseos y entrenamiento siguen con una cantidad fija de lugares. Si se cargan profesionales a un servicio con citas futuras, esas citas siguen ocupando su lugar, pero no quedan asignadas a nadie.
- Contenido por confirmar con el negocio:
  - "Envío el mismo día" (en la tienda) y "Devoluciones gratis durante 30 días" (en la página de producto).
  - Los enlaces de "Privacidad" y "Términos" del pie de página apuntan a "#".
  - FLASH50 no tiene fecha de vencimiento en la base, así que no se muestra cuenta regresiva. Si se quiere, hay que poner la fecha en `pedidos_db.cupones.vence`.
  - Los testimonios y las reseñas son de demostración: ficticios pero coherentes con los clientes de la demo.
- En el servidor hay que correr `ops/reparar-replica.sh` para resolver el error 1236 (se probó en local).
- En macOS con Docker Desktop, los scripts de inicio de la base (`db/master/01-*.sh` y `db/audit/01-*.sh`) fallan con "bad interpreter: Permission denied" y las bases quedan vacías. Con volúmenes nuevos hay que correrlos a mano o cambiar cómo se cargan. En Linux y en CI funcionan.

Lo que no se probó
- Nadie revisó en el navegador las pantallas nuevas: reservar con profesional, agenda (por hora y por consultorio, y el equipo), pacientes, clientes, alta de clientes y cambio de contraseña obligatorio, pedidos, mis citas, mis mascotas, reseñas y checkout. Todo se probó por la API y el frontend compila sin avisos, pero falta revisarlo en escritorio y en celular, con cada rol.
- No se probó subir un adjunto del historial (laboratorio o radiografía) ni abrir su enlace firmado. La foto del catálogo sí se probó.
- El reembolso por la pasarela no se probó con un pago real: falta tener claves.
- No se corrió `tests/seguridad.sh` después de los cambios. Se actualizaron las pruebas afectadas: el límite ahora es de 3 citas por mascota, el motivo es obligatorio en consulta y el vencimiento de pedidos sale del `.env`. La prueba CP-36 necesita internet (clima).
- Los correos nuevos (cita reprogramada, cambios de estado de pedidos) reutilizan la plantilla de citas de EmailJS. No se probaron con claves reales.

Otros pendientes
- Faltan en `docs/` (STRIDE, OWASP, ISO) los eventos nuevos de la bitácora: `HISTORIAL_CORREGIDO`, `CITA_REPROGRAMADA`, `ROL_CAMBIADO`, `PASSWORD_CAMBIADO`, `PRODUCTO_ACTUALIZADO`, `PROFESIONAL_ACTUALIZADO`, `REEMBOLSO_PENDIENTE`, `REEMBOLSO_REGISTRADO`, `PAGO_REEMBOLSADO` y `RESENA_PUBLICADA`. Tampoco reflejan los roles nuevos: hoy dicen que solo el admin entra al panel.
- El bundle del frontend pasa de 500 KB. Conviene cargar el panel (`/admin/*`) con `lazy()`.
- La base local tiene datos de prueba de esta sesión, además de la demo: la mascota "Kiwi", citas de noviembre, la cuenta "Rosa Prueba" y varios pedidos cancelados con su reembolso. Para dejar solo la demo, levantar con volúmenes nuevos y correr `ops/seed-demo.sh`.
- El archivo `env` (sin punto) tiene secretos y no está en `.gitignore`: no subirlo. La contraseña root de la base local se mostró en una sesión de trabajo; conviene cambiarla.
