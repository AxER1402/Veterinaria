Proyecto Veterinaria 



- Historial clínico: existe, pero es básico. Solo se abre desde una fila de la agenda (/admin/agenda, botones "Historial" y "Registrar consulta"). Solo sirve para "Consulta veterinaria", el día de la cita o después, y permite una ficha por cita con peso, diagnóstico, tratamiento y hasta 5 vacunas. El dueño solo ve el carné de vacunas. No hay página de pacientes, no se puede editar y faltan muchos campos clínicos. Los cambios están en el apartado 3.

- Pedidos: el flujo funciona, pero tiene huecos. Si cancelas un pedido ya pagado, no se reembolsa ni aparece ningún aviso. El cliente no recibe correo cuando su pedido cambia de estado. No existe el estado "listo para retirar". Y el admin ve el detalle en la página del cliente, con el botón de pagar incluido.

- Imagen del catálogo: sí, es una URL, y solo acepta fotos de images.unsplash.com. El backend ya tiene preparada la subida a Cloudinary, pero el formulario no la usa y Cloudinary no está configurado en el .env. Además, después de crear un producto ya no se puede cambiar su imagen desde el panel.

- Menú del panel: funciona, pero está armado para la tienda y la auditoría del curso, no para el día a día de la clínica. Falta "Pacientes", la agenda no va primero y no hay roles: todo el personal ve todo, incluida la bitácora y la exportación de clientes.



Lista completa

1. Reservar cita (/contacto#reservar, también desde /servicios)

Está bien:
- Los pasos se entienden: servicio, día, hora, mascota.
- Lo elegido se conserva si el cliente tiene que iniciar sesión.
- La base de datos impide pasarse del cupo aunque dos personas reserven al mismo tiempo.
- Avisa cuando es el "último cupo" y que los domingos está cerrado.
- Se puede dar de alta una mascota sin salir de la reserva.

Hay que arreglar:
- Los cupos son por sede y no por servicio ni por veterinario. Por eso se ven citas en el mismo horario, y la peluquería le quita lugar a la consulta.
- Guardería y hospedaje se reservan como turnos de 30 minutos. Hospedaje necesita fechas de entrada y salida; guardería, un cupo por día.
- Siempre abre en "Hoy", aunque ya no queden horarios. Debería abrir en el primer día con lugar y marcar los días llenos.
- La reserva está dentro de "Contacto". Le conviene su propia página, /reservar.
- El teléfono se escribe cada vez. Hay que guardarlo en el perfil.
- En consulta, el motivo debería ser obligatorio y con opciones rápidas. Para urgencias, el teléfono bien visible.
- No avisa si la mascota ya tiene otra cita ese día, ni impide horarios seguidos en sedes distintas.
- La promoción de guardería aparece aunque se elija consulta.
- El límite de 5 citas activas es por cliente, sin importar cuántas mascotas tenga.

2. Agenda (/admin/agenda)

Está bien:
- Se navega por día, se filtra por sede y el teléfono del cliente se puede llamar con un clic.
- Los bloqueos llevan motivo y hay una lista de próximos bloqueos.
- Cada cambio queda en la bitácora.

Hay que arreglar:
- No se puede agendar una cita para alguien que llama o que llega sin cita.
- No se puede reprogramar, ni desde el panel ni el cliente.
- El menú "Cambiar a" aplica el cambio sin confirmar, y "Atendida", "No asistió" y "Cancelada" no se pueden revertir.
- Si se te olvida registrar la ficha, al día siguiente la cita se cierra sola como "No asistió" y ya no se puede registrar.
- El motivo de cancelación se pide con una ventana nativa del navegador. Hace falta un diálogo propio con motivos predefinidos.
- Las canceladas siguen en la tabla del día. Conviene ocultarlas con un botón "Mostrar canceladas (n)".
- No muestra el consultorio o cupo, aunque el servidor ya lo envía.
- La tabla tiene 9 columnas: en una tablet o celular hay que desplazarse de lado. Mejor una vista por hora y consultorio, y tarjetas en el celular.
- La fecha no queda en la URL, no hay vista semanal ni buscador, y la agenda no se actualiza sola.
- Falta "Confirmar todas las de mañana".
- Para bloquear un horario con citas, primero hay que cancelarlas una por una. Debería poder hacerse en un solo paso, avisando a los clientes.

3. Historial clínico (ventana dentro de la agenda)

Está bien:
- La ficha queda ligada a la cita.
- El peso registrado actualiza el de la mascota.
- Las vacunas llevan lote y fecha de próxima dosis, y el carné calcula el estado: vigente, vence pronto, vencida o renovada.
- Se envía un aviso 7 días antes de cada refuerzo.
- Cada vez que se abre un historial queda en la bitácora, y el diagnóstico no se copia a la bitácora.
- El dueño solo ve el carné, no los diagnósticos.

Cambios que hay que aplicar:
- Una sección de pacientes con buscador por mascota o dueño (/admin/pacientes) y una ficha propia para cada uno (/admin/pacientes/:id). Hoy solo se llega al historial si la mascota tiene cita ese día.
- Poder registrar una consulta sin cita previa (urgencias, gente que llega sin cita).
- Más campos: motivo, anamnesis, examen físico (temperatura, frecuencia cardíaca y respiratoria, mucosas, hidratación, condición corporal), diagnóstico, medicamentos con dosis, frecuencia y duración, indicaciones para el dueño y fecha de próximo control (que proponga crear la cita).
- Alergias y enfermedades crónicas en campos propios, mostradas como alerta en la agenda y en la ficha.
- Corregir con una adenda: el original no se borra y la corrección queda en la bitácora. Hoy, una vez guardada, la ficha no se puede editar.
- Mostrar qué veterinario atendió. Hoy solo se guarda su id.
- Cargar vacunas aplicadas en otra clínica, separar las desparasitaciones y quitar el límite de 5 por consulta.
- Adjuntar resultados de laboratorio y radiografías.
- Imprimir o descargar en PDF la receta, las indicaciones y el carné.
- Notas en los servicios no clínicos, por ejemplo: "en peluquería se le encontró otitis".
- Que la ventana no se cierre con un clic fuera o con Esc sin preguntar. Hoy se pierde todo lo escrito.

4. Mis citas (/cuenta/citas)

Está bien:
- Separa "Próximas" e "Historial".
- Cancelar pide confirmación y respeta la regla de 2 horas.
- Muestra el código de verificación.

Hay que arreglar:
- Las fechas no muestran el año: una consulta de noviembre de 2025 parece futura y dice "Atendida".
- Las canceladas aparecen mezcladas con las atendidas. Hacen falta pestañas Próximas / Pasadas / Canceladas.
- Falta el botón "Reprogramar". "Para cambiarla, llámanos" no trae el teléfono.
- No explica para qué sirve el código de verificación.
- No hay límite ni consecuencia por cancelar o faltar muchas veces.

5. Mis mascotas (/cuenta/mascotas)

Está bien:
- La edad se calcula sola, el carné se despliega en la misma página y la ficha se edita en línea.
- No se borra la mascota (queda inactiva), y no se puede quitar si tiene citas próximas.

Hay que arreglar:
- "Carné", "Editar" y "Quitar" se ven iguales y apilados, aunque "Quitar" es destructiva.
- Las alergias van mezcladas con las notas de temperamento.
- Faltan el botón "Reservar para…" y la próxima vacuna o cita en cada tarjeta.
- "Otro" como especie es muy general. Faltan esterilizado, microchip y color.

6. Clientes (/admin/clientes)

Está bien:
- La exportación a CSV es mínima y queda registrada en la bitácora.
- Se ve el estado de cada cuenta (activa o bloqueada).

Hay que arreglar:
- No hay buscador ni teléfono.
- No se ven las mascotas, citas ni pedidos de cada cliente.
- No hay contadores de cancelaciones y faltas. Falta una ficha por cliente en /admin/clientes/:id.

7. Resumen (/admin)

Está bien:
- La tarjeta "Citas de hoy" va primero y lleva a la agenda.
- La gráfica de ventas tiene la opción de verse como tabla.

Hay que arreglar:
- Mezcla lo clínico con ventas, auditoría y clima "para entregas".
- Falta un resumen clínico: pendientes por confirmar, vacunas que vencen esta semana y faltas recientes.

8. Menú del panel

Está bien:
- El acceso lo verifica el servidor y queda en la bitácora.
- Avisa si el admin no tiene verificación en dos pasos.
- Las pestañas son claras.

Hay que arreglar:
- Reordenarlo para la clínica: Hoy, Agenda, Pacientes, Clientes, Pedidos, Catálogo y, al final, Bitácora.
- Falta "Pacientes".
- No hay roles (veterinario, recepción, tienda, admin): todos ven todo.
- En el encabezado, el acceso al panel es solo un ícono, sin texto.

9. Pedidos (/admin/pedidos, /cuenta/pedidos)

Está bien:
- El total lo calcula el servidor.
- Hay historial de estados con línea de tiempo.
- Respeta las reglas de retiro y domicilio.
- El stock se libera al cancelar y los pedidos sin pagar vencen a las 24 h.
- Los cupones se validan en el servidor.

Hay que arreglar:
- Cancelar un pedido pagado no reembolsa ni avisa al admin que debe hacerlo.
- Un pago que llega después de cancelar solo queda en un log que nadie ve en el panel.
- El cliente no recibe correo cuando el pedido cambia de estado.
- Falta el estado "listo para retirar".
- El cliente no puede cancelar su propio pedido pendiente.
- El admin abre el detalle en la página del cliente, que muestra el botón de pagar y no muestra el contacto completo.
- El cambio de estado se aplica sin confirmar y el motivo se pide con una ventana nativa del navegador.
- No hay buscador ni filtro por fecha, la lista muestra solo los últimos 100 pedidos y no se puede imprimir la lista de preparación.
- Un pedido sin pagar aparta el stock durante 24 h.

10. Catálogo público (/tienda, /tienda/productos, /tienda/producto/:slug)

Está bien:
- Filtros por mascota, categoría, marca y ofertas, buscador y orden.
- Las presentaciones tienen precio propio, hay favoritos y "También te puede gustar".

Hay que arreglar:
- En el celular, los rangos de precio se parten en dos líneas y las tarjetas quedan de alturas distintas.
- Las calificaciones y el número de reseñas están escritos a mano: no hay un sistema real de reseñas.
- Las fotos son de stock, no del producto real.

11. Catálogo en el panel (/admin/catalogo)

Está bien:
- Precio y stock se editan en la misma tabla, y "Guardar" solo se activa si hubo cambios.
- Tiene precio anterior para las ofertas, alta con varias presentaciones y registro en la bitácora.

Hay que arreglar:
- La imagen solo acepta URLs de Unsplash. Hay que conectar la subida a Cloudinary (el backend ya la tiene) y configurar sus claves.
- Después de crear un producto no se pueden cambiar la imagen, el nombre, la descripción, la marca ni la categoría, ni agregar presentaciones.
- La casilla "Activo" esconde el producto de la tienda al instante, sin confirmar.
- No hay buscador ni filtro: son unas 40 filas seguidas.

12. Carrito y checkout (/carrito, /checkout)

Está bien:
- El carrito en el celular se ve bien.
- Avisa cuánto falta para el envío gratis y el estado vacío tiene una acción.
- El total final lo calcula el servidor.

Hay que arreglar:
- Muestra a cualquier cliente los cupones "HUELLITAS10 o FLASH50".
- El paso "3. Pago" tiene una sola opción falsa, y el método real se elige después de crear el pedido.
- El teléfono no viene lleno.

13. Pagos

Está bien:
- No se guardan datos de tarjeta.
- PayPal se captura del lado del servidor y se verifican el monto y el pedido.
- Hay idempotencia, así que un reintento no crea pagos duplicados.

Hay que arreglar:
- PayPal no funciona porque PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET están vacíos en el .env. Stripe tampoco tiene claves, y los pagos con PayPal de la base de datos son datos de demostración.
- Se muestran métodos que no están configurados: el servidor debería informar cuáles están activos.
- Ocultar la tarjeta con una opción de configuración, sin borrar Stripe del backend, porque las pruebas CP-26 a CP-28 y el documento de PCI-DSS dependen de Stripe.
- PayPal agrega su propio botón de "Tarjeta de débito o crédito". Se quita con disable-funding=card.
- La política de seguridad del sitio (CSP) puede bloquear *.paypalobjects.com. Se confirma en la primera prueba con claves.
- No hay mensaje si el cliente cierra la ventana de PayPal.
- El tipo de cambio está fijo en el .env y hay que actualizarlo a mano.
- Hay que cambiar el texto "los datos de tu tarjeta…".

14. Sitio público y aspecto visual (/, /servicios, /nosotros, encabezado y pie)

Está bien:
- Colores, tipografía y tarjetas consistentes, y en escritorio se ve profesional.
- Los estados vacíos tienen acción y las rutas de navegación (breadcrumbs) son claras.

Hay que arreglar:
- En el celular no aparece el botón "Reservar" en el encabezado.
- La página de inicio es muy larga (unos 16 pantallazos en el celular) y repite el formulario de reserva y los botones de "Reservar".
- Las páginas funcionales (cuenta, carrito, checkout) tienen un encabezado azul de unos 450 px.
- "-20% en tu primera compra" y "20% por suscribirte": ese cupón no existe, y el formulario del newsletter no envía nada.
- La cuenta regresiva de la oferta se reinicia cada medianoche.
- Cifras inventadas: "4,9 en 1.200 reseñas", calificaciones de Yelp y Google, "+8.500 mascotas", "12+ años".
- Un testimonio lo firma la mascota.
- "Mi cuenta" habla solo de pedidos, y el ícono de usuario lleva a pedidos y no a citas.

15. Infraestructura y configuración

Está bien:
- Si la réplica de la base de datos no responde, las lecturas pasan al maestro.
- Los recordatorios y los vencimientos corren solos cada 15 minutos.

Hay que arreglar:
- La réplica está caída (Slave_IO_Running: No, error 1236), y los horarios libres se leen de ella. Los clientes pueden ver como libres horarios que ya están ocupados.
- Que el sistema use el maestro también cuando la réplica se atrasa, no solo cuando no responde.
- Faltan las claves de PayPal, Stripe y Cloudinary en el .env.



---

Estado al 28 de octubre de 2026: qué falta de verdad (para el siguiente dev)

Están hechos los apartados 1 a 12, 14 y 15, incluidos los pendientes de la revisión anterior:
- cupos por veterinario, con horarios;
- alta de clientes desde el panel, con contraseña temporal;
- revisión de noches cruzadas al reactivar un hospedaje;
- vista por consultorio;
- adjuntos del historial;
- reembolso desde la pasarela;
- reseñas con aprobación previa.

La subida a Cloudinary ya se probó con una foto real. Del apartado 13 (Pagos) solo se hizo una parte. Abajo va lo que sigue pendiente, lo que no se pudo probar y cómo poner al día otro entorno.

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
