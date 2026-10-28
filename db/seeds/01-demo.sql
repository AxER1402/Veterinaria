-- Datos de demostración de Huellitas: clientes, mascotas, citas, historial clínico, carné de vacunas,
-- pedidos, pagos y stock, relacionados entre sí y entre bases (auth_db, pedidos_db, pagos_db,
-- catalogo_db, citas_db). NO es parte de la instalación (db/master): se carga a mano con
--   ops/seed-demo.sh
-- Idempotente: los ids son fijos (UUID v4) y todo entra con INSERT IGNORE / NOT EXISTS.
-- Las fechas son relativas al día en que se carga: siempre hay citas pasadas, de hoy y futuras
-- (los domingos se corren al sábado o al lunes porque la clínica cierra).
-- Correos @example.com (dominio reservado, RFC 2606): los avisos de la app no llegan a nadie real.
-- Todas las cuentas entran con la contraseña Cliente#2026. La bitácora de auditoría no se siembra:
-- su cadena de hashes la calcula security-audit-service.

SET NAMES utf8mb4;
USE citas_db;

SET @hash := '$2y$12$E8pFqE9GppjA6fgIZ2qnHOr2eFhsvI2DJI.aUBDycNrQfnpNHNDpa';  -- nosemgrep: detected-bcrypt-hash (Cliente#2026, contraseña pública de la demo)
SET @admin := (SELECT id FROM auth_db.usuarios WHERE email = 'admin@huellitas.gt');

-- ---------- Clientes (auth_db.usuarios + pedidos_db.clientes + direcciones) ----------
-- alta = hace cuántos días se registró (antes de su primera cita).
CREATE TEMPORARY TABLE tmp_clientes (
    email      VARCHAR(120) PRIMARY KEY,
    nombre     VARCHAR(100) NOT NULL,
    telefono   VARCHAR(20)  NOT NULL,
    direccion  VARCHAR(200) NOT NULL,
    ciudad     VARCHAR(80)  NOT NULL,
    notas      VARCHAR(200) NULL,
    alta       INT NOT NULL,
    id         INT UNSIGNED NULL
);
INSERT INTO tmp_clientes (email, nombre, telefono, direccion, ciudad, notas, alta) VALUES
 ('cliente@huellitas.gt',          'Lucía Hernández Pineda',          '+502 5873-2914', '7a. avenida 14-28, zona 9, apto. 3B',                    'Guatemala',              'Tocar el timbre del apto. 3B',              400),
 ('mariajose.lopez@example.com',   'María José López Castillo',       '+502 5521-4387', '12 calle 3-45, zona 10, Edificio Torre Real apto. 402',  'Guatemala',              'Dejar en recepción del edificio',           380),
 ('carlos.mendez@example.com',     'Carlos Enrique Méndez Ruiz',      '+502 4789-2256', 'Avenida Las Américas 18-60, zona 13',                    'Guatemala',              NULL,                                        420),
 ('analucia.perez@example.com',    'Ana Lucía Pérez Morales',         '+502 3012-7745', '4a. calle 2-15, zona 3, Colonia El Rosario',             'Mixco',                  'Portón negro, casa esquinera',              230),
 ('jroberto.garcia@example.com',   'José Roberto García Aldana',      '+502 5698-3310', 'Km 15.5 Carretera a El Salvador, Condominio Vista al Lago casa 8', 'Santa Catarina Pinula', 'Avisar en garita a nombre de José García', 120),
 ('gabriela.ramirez@example.com',  'Gabriela Fernanda Ramírez Soto',  '+502 4421-0968', '5a. avenida 8-21, zona 1',                               'Guatemala',              'Local comercial en el primer nivel',        200),
 ('diego.morales@example.com',     'Diego Alejandro Morales Chávez',  '+502 3356-8821', 'Boulevard Vista Hermosa 25-19, zona 15',                 'Guatemala',              NULL,                                        130),
 ('sofia.cifuentes@example.com',   'Sofía Valentina Cifuentes Rivas', '+502 5034-6672', 'Residenciales Catalina, 6a. avenida 3-12, zona 7',       'Villa Nueva',            'Garita 2, casa color terracota',            200);

-- La cuenta cliente@huellitas.gt ya existe (db/master/02): solo se le pone nombre real si aún tiene el genérico.
UPDATE auth_db.usuarios u JOIN tmp_clientes t ON t.email = u.email SET u.nombre = t.nombre WHERE u.nombre = 'Cliente de Prueba';
INSERT IGNORE INTO auth_db.usuarios (nombre, email, password_hash, rol, created_at)
SELECT nombre, email, @hash, 'cliente', NOW() - INTERVAL alta DAY FROM tmp_clientes;
UPDATE tmp_clientes t JOIN auth_db.usuarios u ON u.email = t.email SET t.id = u.id;

INSERT INTO pedidos_db.clientes (id_cliente, nombre, email, telefono, created_at)
SELECT id, nombre, email, telefono, NOW() - INTERVAL alta DAY FROM tmp_clientes
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), telefono = VALUES(telefono);
INSERT IGNORE INTO pedidos_db.direcciones_entrega (id_cliente, direccion, ciudad, notas, created_at)
SELECT id, direccion, ciudad, notas, NOW() - INTERVAL alta DAY FROM tmp_clientes;

-- ---------- Mascotas ----------
-- El peso es el de la última consulta registrada.
CREATE TEMPORARY TABLE tmp_mascotas (
    id          CHAR(36) PRIMARY KEY,
    email       VARCHAR(120) NOT NULL,
    nombre      VARCHAR(60) NOT NULL,
    especie     VARCHAR(10) NOT NULL,
    raza        VARCHAR(60) NULL,
    sexo        VARCHAR(10) NULL,
    nacimiento  DATE NULL,
    peso        DECIMAL(5,2) NULL,
    notas       VARCHAR(300) NULL
);
INSERT INTO tmp_mascotas VALUES
 ('9e71458e-bb97-40aa-93f9-19acccde6a12',  'cliente@huellitas.gt',         'Bruno',  'perro', 'Beagle',                  'macho',  '2021-08-30', 11.80, 'Muy goloso: no darle premios antes de la consulta'),
 ('26299831-0200-4fc8-8548-dc0d56533520',    'cliente@huellitas.gt',         'Mía',    'gato',  'Bengalí',                 'hembra', '2023-09-14',  4.20, NULL),
 ('5c672fef-f8d4-4549-a244-92ff00581e33',   'mariajose.lopez@example.com',  'Luna',   'perro', 'Golden Retriever',        'hembra', '2021-03-14', 28.40, 'Alérgica a la proteína de pollo'),
 ('33cb8cfc-a071-4049-9cbd-3a444dd0e517',  'mariajose.lopez@example.com',  'Michi',  'gato',  'Doméstico de pelo corto', 'macho',  '2022-07-02',  4.60, 'Castrado. Se estresa en el transporte'),
 ('2e0f1cd5-44a4-45eb-aeeb-21a0e907108c',  'carlos.mendez@example.com',    'Rocky',  'perro', 'Bulldog francés',         'macho',  '2020-11-20', 12.10, 'Braquicéfalo: evitar calor y ejercicio intenso'),
 ('c49a9ff0-1666-4d3c-ae03-dcb06c964209', 'analucia.perez@example.com',   'Canela', 'perro', 'Mestiza',                 'hembra', '2019-05-08', 15.20, 'Esterilizada. Nerviosa con otros perros'),
 ('943cb1d1-d7a5-4e5c-9e8a-d8c4c40778aa',   'analucia.perez@example.com',   'Nube',   'gato',  'Persa',                   'hembra', '2023-01-25',  3.80, NULL),
 ('b0e9eacc-2ebe-45e0-9e7a-56fe7272e3db',    'jroberto.garcia@example.com',  'Max',    'perro', 'Pastor alemán',           'macho',  '2018-09-12', 34.70, 'Displasia de cadera leve, en control'),
 ('798a8681-e0ef-4bd0-86ba-40089a137729',  'jroberto.garcia@example.com',  'Kiara',  'perro', 'Labrador Retriever',      'hembra', '2026-03-10', 14.50, 'Cachorra: esquema de vacunación completo'),
 ('b7d682b3-6b5b-4288-b1a5-46442018c75c',   'gabriela.ramirez@example.com', 'Toby',   'perro', 'Shih Tzu',                'macho',  '2017-04-03',  7.90, 'Dermatitis atópica y soplo cardíaco leve, en control'),
 ('03403aee-8e49-459b-82ed-6d18f4fa2cb0',   'diego.morales@example.com',    'Coco',   'otro',  'Conejo cabeza de león',   'hembra', '2023-06-18',  1.60, 'Dieta de heno y verduras; no tolera el baño'),
 ('24f97723-194d-4ce9-b6c8-19fb3099cf51', 'sofia.cifuentes@example.com',  'Pelusa', 'gato',  'Siamés',                  'hembra', '2020-10-05',  4.10, NULL),
 ('dff43f87-4ad9-4f3c-a21a-138d54b689e8',   'sofia.cifuentes@example.com',  'Thor',   'perro', 'Husky siberiano',         'macho',  '2022-12-01', 24.80, 'Muy activo: necesita paseos largos');

INSERT IGNORE INTO citas_db.mascotas (id, id_cliente, nombre, especie, raza, sexo, fecha_nacimiento, peso_kg, notas, created_at)
SELECT m.id, c.id, m.nombre, m.especie, m.raza, m.sexo, m.nacimiento, m.peso, m.notas, NOW() - INTERVAL c.alta DAY
FROM tmp_mascotas m JOIN tmp_clientes c ON c.email = m.email;

-- ---------- Citas ----------
-- dia = días desde hoy (negativo = pasada). Las futuras van a la media hora para no chocar
-- con los turnos en punto que reserva tests/seguridad.sh.
CREATE TEMPORARY TABLE tmp_citas (
    id        CHAR(36) PRIMARY KEY,
    mascota   CHAR(36) NOT NULL,
    servicio  VARCHAR(30) NOT NULL,
    dia       INT NOT NULL,
    hora      TIME NOT NULL,
    estado    VARCHAR(20) NOT NULL,
    notas     VARCHAR(300) NULL,
    inicio    DATETIME NULL
);
INSERT INTO tmp_citas (id, mascota, servicio, dia, hora, estado, notas) VALUES
 -- Consultas atendidas (con historial clínico)
 ('d4ddd01c-d24b-4b0d-8c45-bc73d960aa90', '5c672fef-f8d4-4549-a244-92ff00581e33',   'veterinaria',  -362, '09:00', 'atendida',   'Vacunación anual'),
 ('d1d078d1-0753-43ee-b21a-58598fd9f848', '5c672fef-f8d4-4549-a244-92ff00581e33',   'veterinaria',   -45, '10:30', 'atendida',   'Se rasca mucho las orejas y las patas'),
 ('0bf03af3-47b8-4207-8266-c1bf63d92eee', '33cb8cfc-a071-4049-9cbd-3a444dd0e517',  'veterinaria',  -120, '11:00', 'atendida',   'Chequeo general y vacunas'),
 ('c80e799c-c79a-4cad-b300-98e1c185fae0', '2e0f1cd5-44a4-45eb-aeeb-21a0e907108c',  'veterinaria',  -400, '08:30', 'atendida',   'Vacunación anual'),
 ('810c1ede-b2e3-41cf-b927-5beed51e674d', '2e0f1cd5-44a4-45eb-aeeb-21a0e907108c',  'veterinaria',   -20, '12:00', 'atendida',   'Ronca mucho y se cansa al caminar'),
 ('a065a6dd-a44e-412c-878a-2560a0251f55', 'c49a9ff0-1666-4d3c-ae03-dcb06c964209', 'veterinaria',  -200, '13:30', 'atendida',   'Vacunas antes de ir a guardería'),
 ('abdb0f51-a7c5-434a-a0a5-ba423523e307', 'b0e9eacc-2ebe-45e0-9e7a-56fe7272e3db',    'veterinaria',   -60, '14:00', 'atendida',   'Control de cadera'),
 ('073c751c-deb3-4e90-8a12-1f233b5a52d4', '798a8681-e0ef-4bd0-86ba-40089a137729',  'veterinaria',   -90, '15:00', 'atendida',   'Primera consulta de cachorra'),
 ('9820a428-d1f2-43f9-9fb9-5f7d42cda76b', '798a8681-e0ef-4bd0-86ba-40089a137729',  'veterinaria',   -60, '15:30', 'atendida',   'Segunda dosis'),
 ('de262e2a-b19f-4766-b3a3-77369f22526e', '798a8681-e0ef-4bd0-86ba-40089a137729',  'veterinaria',   -30, '16:00', 'atendida',   'Tercera dosis y rabia'),
 ('fbe6bcfb-6315-499f-b200-48f2d304fa07', 'b7d682b3-6b5b-4288-b1a5-46442018c75c',   'veterinaria',  -150, '09:30', 'atendida',   'Control de piel'),
 ('4f36eef1-8b02-498f-8f09-516696f456b3', 'b7d682b3-6b5b-4288-b1a5-46442018c75c',   'veterinaria',   -14, '10:00', 'atendida',   'Control cardiológico'),
 ('ae0fdbf5-8b57-48f6-8ee4-4a1ddcd4f84f', '24f97723-194d-4ce9-b6c8-19fb3099cf51', 'veterinaria',   -75, '11:30', 'atendida',   'Vacunas anuales'),
 ('7e28dde4-e9bf-4708-9dc9-be4084e2b886', '9e71458e-bb97-40aa-93f9-19acccde6a12',  'veterinaria',  -340, '16:30', 'atendida',   'Vacunación anual'),
 ('6841b8d6-e957-488e-9252-88786cf40e9e', '9e71458e-bb97-40aa-93f9-19acccde6a12',  'veterinaria',   -10, '17:00', 'atendida',   'Vómitos desde anoche'),
 ('84978052-3cdf-4a1d-8328-acf7e393f83c', '03403aee-8e49-459b-82ed-6d18f4fa2cb0',   'veterinaria',  -100, '12:30', 'atendida',   'No quiere comer pellets'),
 ('e993d299-a47c-456d-993e-3d669ed4c87b', 'dff43f87-4ad9-4f3c-a21a-138d54b689e8',   'veterinaria',  -180, '13:00', 'atendida',   'Vacunación anual'),
 ('2e1ee5f8-6dc8-4add-906b-c3506d71f997', '26299831-0200-4fc8-8548-dc0d56533520',    'veterinaria',   -50, '08:00', 'atendida',   'Primera visita y vacunas'),
 -- Otros servicios pasados
 ('896f6125-17f2-4d23-8dc8-7ec38d47bf50', '5c672fef-f8d4-4549-a244-92ff00581e33',   'peluqueria',    -44, '14:30', 'atendida',   'Baño medicado con el shampoo de avena'),
 ('78547598-b40e-47f7-a006-51c3b048748f', 'b7d682b3-6b5b-4288-b1a5-46442018c75c',   'peluqueria',    -28, '17:30', 'atendida',   'Corte cachorro'),
 ('98090a10-2275-4a3e-9a54-0476d86bf940', 'dff43f87-4ad9-4f3c-a21a-138d54b689e8',   'guarderia',     -25, '08:00', 'atendida',   NULL),
 ('5f7ca48b-a804-47a0-aad5-621344c7214e', 'b0e9eacc-2ebe-45e0-9e7a-56fe7272e3db',    'hospedaje',     -16, '09:00', 'atendida',   'Hospedaje de 3 noches; trae su alimento'),
 ('b659bd01-2755-4446-b49c-d66edc496020', '2e0f1cd5-44a4-45eb-aeeb-21a0e907108c',  'paseos',         -6, '18:00', 'atendida',   'Paseo corto, por la tarde'),
 ('7e87a7cf-87c3-41b6-b0db-825ea1bc1da6', 'dff43f87-4ad9-4f3c-a21a-138d54b689e8',   'entrenamiento', -12, '10:00', 'atendida',   'Obediencia: tira de la correa'),
 ('decdd488-38b0-49a2-b9db-09ff74a690dd', 'c49a9ff0-1666-4d3c-ae03-dcb06c964209', 'guarderia',      -8, '08:30', 'no_asistio', NULL),
 ('0bcd6e5c-0cba-4007-b43e-f60fc42d2fce', '943cb1d1-d7a5-4e5c-9e8a-d8c4c40778aa',   'peluqueria',     -5, '15:00', 'cancelada',  'Deslanado'),
 ('dad36486-7053-4adb-b0f4-fd141d71a30c', '33cb8cfc-a071-4049-9cbd-3a444dd0e517',  'veterinaria',    -3, '18:00', 'no_asistio', 'Revisión de una herida en la pata'),
 -- Hoy
 ('f8f8cc60-8d90-4d18-b578-2d690e45da21', '798a8681-e0ef-4bd0-86ba-40089a137729',  'guarderia',       0, '08:30', 'atendida',   NULL),
 ('2fa59b32-9d06-49c4-929e-466bc2e75d29', '5c672fef-f8d4-4549-a244-92ff00581e33',   'peluqueria',      0, '18:30', 'confirmada', 'Baño y corte de uñas'),
 ('fc3ee9eb-b534-4992-8431-6dc39c58bfbf', 'b0e9eacc-2ebe-45e0-9e7a-56fe7272e3db',    'veterinaria',     0, '19:00', 'pendiente',  'Cojea de la pata trasera izquierda'),
 -- Próximas
 ('89ff2e89-c092-4212-9f6b-ea88b4aaba48', '5c672fef-f8d4-4549-a244-92ff00581e33',   'veterinaria',     3, '09:30', 'confirmada', 'Refuerzo anual de rabia y séxtuple'),
 ('159e45eb-16fa-45e1-9590-496e4089e85a', '2e0f1cd5-44a4-45eb-aeeb-21a0e907108c',  'veterinaria',     2, '11:30', 'confirmada', 'Revisión del oído derecho'),
 ('5324ce1a-acac-4d10-9a63-3a6ec638f275', 'b7d682b3-6b5b-4288-b1a5-46442018c75c',   'veterinaria',     5, '10:30', 'pendiente',  'Control de piel'),
 ('6fc6e427-eb5f-4f36-b178-9d5811362934', '03403aee-8e49-459b-82ed-6d18f4fa2cb0',   'peluqueria',      6, '14:30', 'pendiente',  'Corte de uñas'),
 ('737f245a-6f58-458c-9ade-8fe80f8a20f3', 'dff43f87-4ad9-4f3c-a21a-138d54b689e8',   'guarderia',       1, '08:30', 'confirmada', NULL),
 ('d847f372-2058-479f-a543-63189cd4efda', 'b0e9eacc-2ebe-45e0-9e7a-56fe7272e3db',    'hospedaje',      12, '09:30', 'pendiente',  'Viaje familiar: 4 noches'),
 ('66f0483b-36e4-468e-9663-d8d10a7c73de', 'c49a9ff0-1666-4d3c-ae03-dcb06c964209', 'paseos',          4, '16:30', 'confirmada', 'Pasearla sola, no en grupo'),
 ('c8b185b3-5120-4004-8fb8-dc173fb36eb4', '24f97723-194d-4ce9-b6c8-19fb3099cf51', 'peluqueria',      9, '12:30', 'pendiente',  'Baño y deslanado'),
 ('a8c8e998-e194-4ea7-b8f8-5ae408521f64', '798a8681-e0ef-4bd0-86ba-40089a137729',  'entrenamiento',   7, '10:30', 'pendiente',  'Obediencia básica, sesión 3'),
 ('7b99e66a-e1d4-4d8f-a676-3d2a14f35c0a', '943cb1d1-d7a5-4e5c-9e8a-d8c4c40778aa',   'veterinaria',    15, '15:30', 'pendiente',  'Evaluación antes de esterilizarla'),
 ('69814d08-c81c-4b5c-bfc8-2fb5adb09272', '9e71458e-bb97-40aa-93f9-19acccde6a12',  'peluqueria',      8, '11:30', 'cancelada',  'Baño'),
 ('075aa051-c15d-4229-aeb7-570458a10818', '26299831-0200-4fc8-8548-dc0d56533520',    'peluqueria',     10, '13:30', 'pendiente',  'Corte de uñas');

UPDATE tmp_citas SET inicio = TIMESTAMP(
    CURDATE() + INTERVAL dia DAY + INTERVAL IF(DAYOFWEEK(CURDATE() + INTERVAL dia DAY) = 1, IF(dia < 0, -1, 1), 0) DAY,
    hora);

-- recordatorio_at lleno: la tarea de recordatorios no le escribe a estos correos de ejemplo.
INSERT IGNORE INTO citas_db.citas (id, id_cliente, mascota_id, servicio, sede, inicio, cupo, estado,
                                   cliente_nombre, cliente_email, telefono, notas, recordatorio_at, created_at)
SELECT t.id, m.id_cliente, t.mascota, t.servicio, s.sede, t.inicio, 1, t.estado,
       c.nombre, c.email, c.telefono, t.notas, NOW(), LEAST(t.inicio - INTERVAL 3 DAY, NOW() - INTERVAL 2 HOUR)
FROM tmp_citas t
JOIN citas_db.mascotas m ON m.id = t.mascota
JOIN citas_db.servicios s ON s.slug = t.servicio
JOIN tmp_clientes c ON c.id = m.id_cliente;

-- Historial de estados: solo para las citas que todavía no tienen (las recién sembradas).
INSERT INTO citas_db.historial_citas (cita_id, estado_anterior, estado_nuevo, cambiado_por, comentario, fecha)
SELECT c.id, NULL, 'pendiente', c.id_cliente, 'Cita reservada por el cliente', c.created_at
  FROM citas_db.citas c WHERE NOT EXISTS (SELECT 1 FROM citas_db.historial_citas h WHERE h.cita_id = c.id)
UNION ALL
SELECT c.id, 'pendiente', 'confirmada', @admin, NULL, LEAST(c.created_at + INTERVAL 2 HOUR, NOW() - INTERVAL 90 MINUTE)
  FROM citas_db.citas c WHERE c.estado IN ('confirmada', 'atendida')
   AND NOT EXISTS (SELECT 1 FROM citas_db.historial_citas h WHERE h.cita_id = c.id)
UNION ALL
SELECT c.id, 'confirmada', 'atendida', @admin,
       IF(c.servicio = 'veterinaria', 'Consulta registrada en el historial clínico', NULL), c.inicio + INTERVAL 45 MINUTE
  FROM citas_db.citas c WHERE c.estado = 'atendida'
   AND NOT EXISTS (SELECT 1 FROM citas_db.historial_citas h WHERE h.cita_id = c.id)
UNION ALL
SELECT c.id, 'pendiente', 'no_asistio', NULL, 'Cierre automático: la cita pasó sin atenderse', DATE(c.inicio) + INTERVAL 2 DAY + INTERVAL 15 MINUTE
  FROM citas_db.citas c WHERE c.estado = 'no_asistio'
   AND NOT EXISTS (SELECT 1 FROM citas_db.historial_citas h WHERE h.cita_id = c.id)
UNION ALL
SELECT c.id, 'pendiente', 'cancelada', c.id_cliente, 'Cancelada por el cliente', LEAST(c.created_at + INTERVAL 1 DAY, NOW() - INTERVAL 1 HOUR)
  FROM citas_db.citas c WHERE c.estado = 'cancelada'
   AND NOT EXISTS (SELECT 1 FROM citas_db.historial_citas h WHERE h.cita_id = c.id);

-- ---------- Historial clínico ----------
CREATE TEMPORARY TABLE tmp_historial (
    id           CHAR(36) PRIMARY KEY,
    cita         CHAR(36) NOT NULL,
    peso         DECIMAL(5,2) NULL,
    diagnostico  VARCHAR(500) NOT NULL,
    tratamiento  VARCHAR(500) NULL
);
INSERT INTO tmp_historial VALUES
 ('10663254-83a2-4340-a0f6-b09642c1b865', 'd4ddd01c-d24b-4b0d-8c45-bc73d960aa90', 27.90, 'Paciente sano. Condición corporal 5/9, mucosas rosadas, sin hallazgos a la auscultación.', 'Vacunas anuales aplicadas. Desparasitación interna con praziquantel/pirantel.'),
 ('6d2c371c-887a-4c78-abc4-8e42136c6ae7', 'd1d078d1-0753-43ee-b21a-58598fd9f848', 28.40, 'Otitis externa bilateral y dermatitis interdigital compatibles con alergia alimentaria.', 'Limpieza ótica cada 48 h por 2 semanas, gotas óticas con antibiótico y corticoide. Dieta hipoalergénica de proteína hidrolizada por 8 semanas.'),
 ('6454baf8-cd11-4265-9877-4031d6e1766a', '0bf03af3-47b8-4207-8266-c1bf63d92eee',  4.60, 'Paciente sano. Sarro dental grado 1.', 'Vacunas aplicadas. Se recomienda limpieza dental en 6 meses.'),
 ('ff0c6a35-6e84-4946-9968-17ee20bcea1c', 'c80e799c-c79a-4cad-b300-98e1c185fae0', 11.70, 'Paciente sano. Paladar blando ligeramente elongado, sin dificultad respiratoria en reposo.', 'Vacunas anuales aplicadas. Control de peso.'),
 ('6e39f106-ade4-46c4-8921-efd949732b7f', '810c1ede-b2e3-41cf-b927-5beed51e674d', 12.10, 'Síndrome braquicefálico moderado: narinas estenóticas y ronquido marcado. Leve sobrepeso.', 'Evitar ejercicio en horas de calor y usar arnés en lugar de collar. Reducir la ración un 10 %. Evaluar cirugía de narinas.'),
 ('23822016-48fa-4d28-bda7-83942fcf7bf8', 'a065a6dd-a44e-412c-878a-2560a0251f55', 15.00, 'Paciente sano. Apta para guardería.', 'Vacunas aplicadas, incluida Bordetella para convivencia con otros perros.'),
 ('fec8dc72-d466-487a-83c4-e77abfbe6a83', 'abdb0f51-a7c5-434a-a0a5-ba423523e307', 34.70, 'Displasia de cadera leve bilateral, sin progresión respecto a la radiografía anterior.', 'Meloxicam 0.1 mg/kg cada 24 h por 7 días si hay dolor. Condroprotector diario. Paseos cortos y frecuentes, sin saltos.'),
 ('c280c7cd-0de3-43de-ae19-d9b85694e278', '073c751c-deb3-4e90-8a12-1f233b5a52d4',  6.20, 'Cachorra sana, buen desarrollo para la edad.', 'Primera dosis de séxtuple. Desparasitación con pamoato de pirantel.'),
 ('f77af571-5fc6-4299-bcb3-80b084e7e86e', '9820a428-d1f2-43f9-9fb9-5f7d42cda76b',  9.80, 'Cachorra sana. Buen aumento de peso.', 'Segunda dosis de séxtuple.'),
 ('e00197e3-1735-4699-bcc3-509115813f7a', 'de262e2a-b19f-4766-b3a3-77369f22526e', 14.50, 'Cachorra sana. Esquema de cachorro completo.', 'Tercera dosis de séxtuple y primera de rabia. Refuerzo anual.'),
 ('fd84c377-0712-4fdc-90cc-dbb0eaab921b', 'fbe6bcfb-6315-499f-b200-48f2d304fa07',  8.10, 'Dermatitis atópica en control; piel con leve eritema en axilas.', 'Baños con shampoo de avena cada 7 días. Oclacitinib 0.5 mg/kg cada 24 h por 14 días.'),
 ('ff505ff5-f712-406e-89fa-2e6ea9405e6e', '4f36eef1-8b02-498f-8f09-516696f456b3',  7.90, 'Soplo mitral grado II/VI, sin signos de insuficiencia cardíaca.', 'Ecocardiograma de control en 6 meses. Dieta baja en sodio. Consultar si tose o se cansa.'),
 ('b073bfff-6e97-4515-abc0-8a61e2515426', 'ae0fdbf5-8b57-48f6-8ee4-4a1ddcd4f84f',  4.10, 'Paciente sana.', 'Vacunas anuales aplicadas.'),
 ('9c0fbb21-af4c-4da0-8dc0-352ef27ef4d5', '7e28dde4-e9bf-4708-9dc9-be4084e2b886', 11.30, 'Paciente sano. Ligero sobrepeso (condición corporal 6/9).', 'Vacunas anuales aplicadas. Reducir premios.'),
 ('669756b5-8215-4927-b71b-c30930977d9f', '6841b8d6-e957-488e-9252-88786cf40e9e', 11.80, 'Gastroenteritis leve por ingesta de basura. Hidratado, abdomen sin dolor a la palpación.', 'Ayuno de 12 h, luego dieta blanda de arroz con carne magra por 3 días. Probiótico por 5 días.'),
 ('11359376-671f-4bdb-9075-791bf9e253ad', '84978052-3cdf-4a1d-8328-acf7e393f83c',  1.60, 'Sobrecrecimiento de incisivos superiores.', 'Limado dental. Heno a libre demanda y menos pellets.'),
 ('da38ced7-477a-479a-aee6-7c21d377b64f', 'e993d299-a47c-456d-993e-3d669ed4c87b', 24.80, 'Paciente sano.', 'Vacunas anuales aplicadas, incluida Bordetella.'),
 ('3468ea3d-ac33-4416-8dcd-6ba666cb8fdc', '2e1ee5f8-6dc8-4add-906b-c3506d71f997',  4.20, 'Paciente sana. Primera visita.', 'Vacunas aplicadas. Desparasitación interna.');

INSERT IGNORE INTO citas_db.historial_clinico (id, cita_id, mascota_id, peso_kg, diagnostico, tratamiento, registrado_por, created_at)
SELECT h.id, h.cita, c.mascota_id, h.peso, h.diagnostico, h.tratamiento, @admin, c.inicio + INTERVAL 45 MINUTE
FROM tmp_historial h JOIN citas_db.citas c ON c.id = h.cita;

-- ---------- Carné de vacunas ----------
-- refuerzo = días hasta la próxima dosis. Quedan vacunas vigentes, por vencer (Luna) y vencidas (Rocky).
-- aviso_at lleno: no se manda el aviso de refuerzo a estos correos de ejemplo.
CREATE TEMPORARY TABLE tmp_vacunas (
    id         CHAR(36) PRIMARY KEY,
    historial  CHAR(36) NOT NULL,
    nombre     VARCHAR(80) NOT NULL,
    lote       VARCHAR(40) NULL,
    refuerzo   INT NULL
);
INSERT INTO tmp_vacunas VALUES
 ('f75f1bb7-f8e5-4a35-8ff4-2badbfaebf55', '10663254-83a2-4340-a0f6-b09642c1b865', 'Rabia',                'NR-25031', 365),
 ('9a4449d1-dc4c-4d97-83f7-00eeb7ec3223', '10663254-83a2-4340-a0f6-b09642c1b865', 'Séxtuple (DHPPi+L)',   'VP-24887', 365),
 ('1cd4fb6f-f9ad-4962-ada1-d168ba92f006', '6454baf8-cd11-4265-9877-4031d6e1766a', 'Triple felina',        'TF-25102', 365),
 ('ec59a56c-71d2-4b9b-a196-7cbf23a4211b', '6454baf8-cd11-4265-9877-4031d6e1766a', 'Rabia',                'NR-25118', 365),
 ('577c470e-e36a-4177-9343-0260a4281bbc', 'ff0c6a35-6e84-4946-9968-17ee20bcea1c', 'Rabia',                'NR-24877', 365),
 ('bf39c883-70ac-4f0b-bd7e-abedfb14228e', 'ff0c6a35-6e84-4946-9968-17ee20bcea1c', 'Séxtuple (DHPPi+L)',   'VP-24790', 365),
 ('f7a186da-3e62-49af-b50b-3cb72ab4274f', '23822016-48fa-4d28-bda7-83942fcf7bf8', 'Rabia',                'NR-25064', 365),
 ('2af5c2d9-e4f4-4157-b9af-b69a08369170', '23822016-48fa-4d28-bda7-83942fcf7bf8', 'Séxtuple (DHPPi+L)',   'VP-25012', 365),
 ('aca3ccd9-2343-4027-a900-6ec9dcbc89b4', '23822016-48fa-4d28-bda7-83942fcf7bf8', 'Bordetella',           'BB-25007', 365),
 ('0eb9df52-ad0e-475d-92b1-ac6f2f0a079a', 'fec8dc72-d466-487a-83c4-e77abfbe6a83', 'Rabia',                'NR-26041', 365),
 ('18e1c450-f793-4731-9175-833d14f4b647', 'c280c7cd-0de3-43de-ae19-d9b85694e278', 'Séxtuple (DHPPi+L)',   'VP-26015',  30),
 ('fefec250-fa71-48b3-b58d-86092884cc14', 'f77af571-5fc6-4299-bcb3-80b084e7e86e', 'Séxtuple (DHPPi+L)',   'VP-26033',  30),
 ('0d90c3a1-2fb4-42c8-8119-8ce080e79e7d', 'e00197e3-1735-4699-bcc3-509115813f7a', 'Séxtuple (DHPPi+L)',   'VP-26058', 365),
 ('8d3382ce-e3f0-4d6f-b70a-d0488be2545a', 'e00197e3-1735-4699-bcc3-509115813f7a', 'Rabia',                'NR-26072', 365),
 ('314e798b-f9ee-402d-b2b0-3f08823e6857', 'fd84c377-0712-4fdc-90cc-dbb0eaab921b', 'Rabia',                'NR-26019', 365),
 ('dfe5c166-ccc9-46ac-aae6-61f4371cb82c', 'b073bfff-6e97-4515-abc0-8a61e2515426', 'Triple felina',        'TF-26024', 365),
 ('96db12e2-62d7-4bd1-9826-5c72b0dd9f38', 'b073bfff-6e97-4515-abc0-8a61e2515426', 'Leucemia felina',      'LF-26009', 365),
 ('c714b936-d9ba-4a82-a0e0-68aeee65f2f4', '9c0fbb21-af4c-4da0-8dc0-352ef27ef4d5', 'Rabia',                'NR-25049', 365),
 ('9462627f-c4ad-469f-ba7e-8c055da239af', '9c0fbb21-af4c-4da0-8dc0-352ef27ef4d5', 'Séxtuple (DHPPi+L)',   'VP-25051', 365),
 ('2ad47429-3ab7-4e48-8f07-73a363150509', 'da38ced7-477a-479a-aee6-7c21d377b64f', 'Rabia',                'NR-26002', 365),
 ('36d5bac0-809c-4931-b75b-fa0f2a95f84b', 'da38ced7-477a-479a-aee6-7c21d377b64f', 'Séxtuple (DHPPi+L)',   'VP-26004', 365),
 ('e8b86d07-a29e-4d59-ac00-6151d0966d29', 'da38ced7-477a-479a-aee6-7c21d377b64f', 'Bordetella',           'BB-26001', 365),
 ('ebc87dfa-702b-43b0-af40-7d6818af76e6', '3468ea3d-ac33-4416-8dcd-6ba666cb8fdc', 'Triple felina',        'TF-26061', 365),
 ('c64b964a-74f6-4a8d-95f3-7c9e10c745ca', '3468ea3d-ac33-4416-8dcd-6ba666cb8fdc', 'Rabia',                'NR-26066', 365);

INSERT IGNORE INTO citas_db.vacunas (id, mascota_id, historial_id, nombre, lote, fecha_aplicacion, proxima_dosis, aviso_at, created_at)
SELECT v.id, h.mascota_id, v.historial, v.nombre, v.lote, DATE(h.created_at), DATE(h.created_at) + INTERVAL v.refuerzo DAY, NOW(), h.created_at
FROM tmp_vacunas v JOIN citas_db.historial_clinico h ON h.id = v.historial;

-- ---------- Pedidos ----------
-- horas = hace cuántas horas se creó. Precios, nombres e imágenes salen del catálogo (por SKU);
-- subtotal, descuento, envío y total se calculan igual que Totales.php.
CREATE TEMPORARY TABLE tmp_pedidos (
    id          CHAR(36) PRIMARY KEY,
    email       VARCHAR(120) NOT NULL,
    estado      VARCHAR(20) NOT NULL,
    entrega     VARCHAR(10) NOT NULL,
    sede        VARCHAR(120) NULL,
    cupon       VARCHAR(30) NULL,
    horas       INT NOT NULL,
    pago        VARCHAR(10) NULL,       -- pasarela; NULL = nunca intentó pagar
    pago_id     CHAR(36) NULL,
    referencia  VARCHAR(255) NULL,
    evento      VARCHAR(255) NULL       -- webhook de Stripe
);
SET @centro := 'Clínica veterinaria y peluquería · 6a. avenida 9-35, zona 10';
SET @norte  := 'Guardería y hospedaje – Norte · Calzada José Milla y Vidaurre 10-55, zona 6';
SET @sur    := 'Paseadores y cuidadores – Sur · Calzada Aguilar Batres 34-70, zona 11';
INSERT INTO tmp_pedidos VALUES
 ('7e2f7733-6be9-445c-be7b-203b85fac7b0', 'cliente@huellitas.gt',         'entregado',      'domicilio', NULL,    NULL,          960, 'stripe', 'c8597cb7-4055-4422-a3c5-3563c977a4c1', 'pi_3TToFuHsEPbwi0zk3z6A2f0l', 'evt_3UbmRIuUVkOEZfYiABITcEFG'),
 ('d0bdfd6d-b60b-4e07-9eeb-29a9538002ff', 'cliente@huellitas.gt',         'entregado',      'retiro',    @centro, 'HUELLITAS10', 290, 'paypal', 'c0d05932-3bce-4689-8ee2-baea84a89187', '152JENFNT91VXC1FR', NULL),
 ('d578253b-53e1-4d37-b467-5182936f0be1', 'cliente@huellitas.gt',         'enviado',        'domicilio', NULL,    NULL,           50, 'stripe', '016cb9f5-a28a-4eab-9901-f32f37587fa8', 'pi_3urGXgWKJ8SAMbuGxAXnzTCv', 'evt_3VjbVlNzAw2uqEtbTG4iucnw'),
 ('e1808d48-653e-4929-82b9-27fb1235d75a', 'cliente@huellitas.gt',         'pendiente_pago', 'retiro',    @centro, NULL,            3, NULL,     NULL,      NULL,        NULL),
 ('168ff07d-b2aa-4c45-af95-d36938edab4e', 'mariajose.lopez@example.com',  'entregado',      'domicilio', NULL,    'FLASH50',     600, 'stripe', '091fbac2-9b18-4e2a-9253-d89db633c374', 'pi_3SyJ9hVX6P7Syt9uqLO0GCzv', 'evt_3SUpS4VpUEWGTyLeyW6MfkZ4'),
 ('6acba0e7-7690-49ac-9abb-bfa80efbb319', 'mariajose.lopez@example.com',  'preparando',     'retiro',    @centro, NULL,          146, 'paypal', '12efbca1-c684-443f-83dc-9a3cd6353339', 'WLICBK37T1X7CBPHI', NULL),
 ('7a6073ea-44f4-4df1-9737-d67e7d04bb1c', 'carlos.mendez@example.com',    'entregado',      'domicilio', NULL,    NULL,          795, 'stripe', 'aaeafcad-4e5b-427a-8435-fdbcbb15c4d2', 'pi_3DpW0U7TxbGuAqBYrvbCQS3l', 'evt_39cEe3jmC28ZEBGTWxqiQvIS'),
 ('a47724fc-5545-4bcc-9b6c-9ead21722391', 'carlos.mendez@example.com',    'cancelado',      'domicilio', NULL,    NULL,           98, 'stripe', '3f3f463d-3e2e-41da-a882-692430f32447', 'pi_3H6wkZDdDVpTZD29miAOnHa9', 'evt_3AM6CBevcuDkgFv413GLUbtL'),
 ('75e380e1-ee44-4477-859e-0bb14f81256d', 'analucia.perez@example.com',   'entregado',      'retiro',    @norte,  NULL,          435, 'paypal', '0f927875-a8b8-4f45-8182-29fb8597dc64', '11CD7XJL0D2A8E8XP', NULL),
 ('82e73049-2455-4ec2-9908-92d46007b946', 'jroberto.garcia@example.com',  'pagado',        'domicilio', NULL,    'HUELLITAS10',  22, 'stripe', 'c3898098-3efe-4c6d-8e68-c3a4f97f770f', 'pi_3T5AzrNZFRSr7XWGa5kaByG5', 'evt_3aVKy3HkIdn2GtAkDae5Ss6n'),
 ('4cea1aea-51f5-494d-a32b-1423f1da66fd', 'gabriela.ramirez@example.com', 'entregado',      'domicilio', NULL,    NULL,          218, 'stripe', 'ea1c3a3b-a5ec-4fca-8116-5093211d9f5f', 'pi_3mvZ0ATeaOWKHyD35NNkk0WA', 'evt_3tUurFO1AHLlJBwKpg7vmkWX'),
 ('c73f7994-8b37-4c3d-9323-27608a7fb8b0', 'diego.morales@example.com',    'entregado',      'retiro',    @sur,    NULL,          362, 'paypal', '8a625b32-dff8-42b1-b32a-4534f88984de', 'FLKB06JXCVYSR0N4M', NULL),
 ('f4858630-51a3-4458-9016-906b3f8bf379', 'sofia.cifuentes@example.com',  'pagado',        'domicilio', NULL,    NULL,            5, 'stripe', 'd51444a6-5e23-49a4-a53c-a3473ec8b6f6', 'pi_3fRZIf0hyv6sqeO8hBgDPNnt', 'evt_3JGSDw62EFjMMbzs4Xnx6Bdq');

CREATE TEMPORARY TABLE tmp_items (pedido CHAR(36) NOT NULL, sku VARCHAR(40) NOT NULL, cantidad SMALLINT UNSIGNED NOT NULL);
INSERT INTO tmp_items VALUES
 ('7e2f7733-6be9-445c-be7b-203b85fac7b0', 'HU-001-2', 1), ('7e2f7733-6be9-445c-be7b-203b85fac7b0', 'HU-003-1', 2),
 ('d0bdfd6d-b60b-4e07-9eeb-29a9538002ff', 'HU-022-2', 1), ('d0bdfd6d-b60b-4e07-9eeb-29a9538002ff', 'HU-009-1', 2),
 ('d578253b-53e1-4d37-b467-5182936f0be1', 'HU-023-1', 1), ('d578253b-53e1-4d37-b467-5182936f0be1', 'HU-021-1', 1),
 ('e1808d48-653e-4929-82b9-27fb1235d75a', 'HU-011-1', 1),
 ('168ff07d-b2aa-4c45-af95-d36938edab4e', 'HU-001-3', 1), ('168ff07d-b2aa-4c45-af95-d36938edab4e', 'HU-010-1', 1),
 ('6acba0e7-7690-49ac-9abb-bfa80efbb319', 'HU-021-2', 1), ('6acba0e7-7690-49ac-9abb-bfa80efbb319', 'HU-012-1', 1),
 ('7a6073ea-44f4-4df1-9737-d67e7d04bb1c', 'HU-002-2', 2), ('7a6073ea-44f4-4df1-9737-d67e7d04bb1c', 'HU-004-1', 1),
 ('a47724fc-5545-4bcc-9b6c-9ead21722391', 'HU-008-2', 1),
 ('75e380e1-ee44-4477-859e-0bb14f81256d', 'HU-022-1', 2), ('75e380e1-ee44-4477-859e-0bb14f81256d', 'HU-009-2', 1),
 ('82e73049-2455-4ec2-9908-92d46007b946', 'HU-001-3', 2), ('82e73049-2455-4ec2-9908-92d46007b946', 'HU-005-3', 1),
 ('4cea1aea-51f5-494d-a32b-1423f1da66fd', 'HU-021-1', 2), ('4cea1aea-51f5-494d-a32b-1423f1da66fd', 'HU-006-1', 1),
 ('c73f7994-8b37-4c3d-9323-27608a7fb8b0', 'HU-024-1', 2), ('c73f7994-8b37-4c3d-9323-27608a7fb8b0', 'HU-016-2', 1),
 ('f4858630-51a3-4458-9016-906b3f8bf379', 'HU-010-2', 1), ('f4858630-51a3-4458-9016-906b3f8bf379', 'HU-011-1', 1), ('f4858630-51a3-4458-9016-906b3f8bf379', 'HU-007-3', 1);

-- Entra en cero y los totales se calculan después (el CHECK exige total = subtotal - descuento + envío).
INSERT IGNORE INTO pedidos_db.pedidos (id, id_cliente, estado, metodo_entrega, sede, direccion_id, subtotal, descuento, envio, total, cupon, fecha)
SELECT p.id, c.id, p.estado, p.entrega, p.sede, IF(p.entrega = 'domicilio', d.id, NULL), 0, 0, 0, 0, p.cupon, NOW() - INTERVAL p.horas HOUR
FROM tmp_pedidos p
JOIN tmp_clientes c ON c.email = p.email
LEFT JOIN pedidos_db.direcciones_entrega d ON d.id_cliente = c.id AND d.direccion = c.direccion AND d.ciudad = c.ciudad;

INSERT INTO pedidos_db.detalle_pedidos (pedido_id, producto_id, variante_id, producto_nombre, variante_etiqueta, imagen_url, precio_unitario, cantidad, subtotal)
SELECT i.pedido, v.producto_id, v.id, pr.nombre, v.etiqueta, pr.imagen_url, v.precio, i.cantidad, v.precio * i.cantidad
FROM tmp_items i
JOIN catalogo_db.producto_variantes v ON v.sku = i.sku
JOIN catalogo_db.productos pr ON pr.id = v.producto_id
WHERE NOT EXISTS (SELECT 1 FROM pedidos_db.detalle_pedidos d WHERE d.pedido_id = i.pedido);

-- Totales (en una tabla aparte: MariaDB no deja leer pedidos en el mismo UPDATE que los modifica).
-- El cupón aplica a todo el carrito o solo a su marca; envío de Q35, gratis desde Q400 o al retirar en sede.
CREATE TEMPORARY TABLE tmp_totales AS
SELECT d.pedido_id,
       SUM(d.subtotal) AS subtotal,
       IFNULL(ROUND(SUM(IF(cu.marca IS NULL OR cu.marca = pr.marca, d.subtotal, 0)) * MAX(cu.porcentaje) / 100, 2), 0) AS descuento
FROM pedidos_db.detalle_pedidos d
JOIN pedidos_db.pedidos p ON p.id = d.pedido_id
JOIN catalogo_db.productos pr ON pr.id = d.producto_id
LEFT JOIN pedidos_db.cupones cu ON cu.codigo = p.cupon
WHERE p.total = 0
GROUP BY d.pedido_id;

UPDATE pedidos_db.pedidos p JOIN tmp_totales t ON t.pedido_id = p.id
SET p.subtotal  = t.subtotal,
    p.descuento = t.descuento,
    p.envio     = IF(p.metodo_entrega = 'retiro' OR t.subtotal - t.descuento >= 400, 0, 35.00),
    p.total     = t.subtotal - t.descuento + IF(p.metodo_entrega = 'retiro' OR t.subtotal - t.descuento >= 400, 0, 35.00),
    p.updated_at = p.fecha;

-- ---------- Stock ----------
-- Como StockController: cada pedido aparta sus unidades; el cancelado las devolvió (reserva «liberada»).
UPDATE catalogo_db.producto_variantes v
JOIN (SELECT d.variante_id, SUM(d.cantidad) AS cantidad
        FROM pedidos_db.detalle_pedidos d
        JOIN pedidos_db.pedidos p ON p.id = d.pedido_id
        JOIN tmp_pedidos t ON t.id = p.id
       WHERE p.estado <> 'cancelado'
         AND NOT EXISTS (SELECT 1 FROM catalogo_db.reservas_stock r WHERE r.pedido_id = p.id)
       GROUP BY d.variante_id) x ON x.variante_id = v.id
SET v.stock = v.stock - x.cantidad;

INSERT IGNORE INTO catalogo_db.reservas_stock (pedido_id, variante_id, cantidad, estado, created_at)
SELECT d.pedido_id, d.variante_id, SUM(d.cantidad), IF(p.estado = 'cancelado', 'liberada', 'reservada'), p.fecha
FROM pedidos_db.detalle_pedidos d
JOIN pedidos_db.pedidos p ON p.id = d.pedido_id
JOIN tmp_pedidos t ON t.id = p.id
GROUP BY d.pedido_id, d.variante_id, p.estado, p.fecha;

-- ---------- Pagos ----------
-- Stripe cobra en quetzales; PayPal en dólares al tipo de cambio (@tipo_cambio lo pone ops/seed-demo.sh).
-- El pedido cancelado tuvo un intento con tarjeta rechazada y luego venció sin pago.
INSERT IGNORE INTO pagos_db.pagos (id, id_pedido, id_cliente, monto, moneda, monto_pasarela, moneda_pasarela, metodo, payment_intent_id, stripe_status, estado, fecha_pago, created_at)
SELECT t.pago_id, p.id, p.id_cliente, p.total, 'GTQ',
       IF(t.pago = 'paypal', ROUND(p.total / @tipo_cambio, 2), p.total), IF(t.pago = 'paypal', 'USD', 'GTQ'),
       t.pago, t.referencia,
       IF(p.estado = 'cancelado', 'requires_payment_method', IF(t.pago = 'stripe', 'succeeded', 'COMPLETED')),
       IF(p.estado = 'cancelado', 'fallido', 'confirmado'),
       IF(p.estado = 'cancelado', NULL, p.fecha + INTERVAL 3 MINUTE),
       p.fecha + INTERVAL 1 MINUTE
FROM tmp_pedidos t JOIN pedidos_db.pedidos p ON p.id = t.id
WHERE t.pago IS NOT NULL;

INSERT IGNORE INTO pagos_db.webhook_eventos (event_id, proveedor, tipo, payment_intent_id, recibido_en, resultado)
SELECT t.evento, 'stripe', IF(p.estado = 'cancelado', 'payment_intent.payment_failed', 'payment_intent.succeeded'),
       t.referencia, p.fecha + INTERVAL 3 MINUTE, IF(p.estado = 'cancelado', 'fallido', 'confirmado')
FROM tmp_pedidos t JOIN pedidos_db.pedidos p ON p.id = t.id
WHERE t.evento IS NOT NULL;

-- Historial de estados: solo para los pedidos que todavía no tienen (los recién sembrados).
INSERT INTO pedidos_db.historial_estados (pedido_id, estado_anterior, estado_nuevo, cambiado_por, comentario, fecha)
SELECT p.id, NULL, 'pendiente_pago', p.id_cliente, 'Pedido creado por el cliente', p.fecha
  FROM pedidos_db.pedidos p WHERE NOT EXISTS (SELECT 1 FROM pedidos_db.historial_estados h WHERE h.pedido_id = p.id)
UNION ALL
SELECT p.id, 'pendiente_pago', 'pagado', NULL,
       CONCAT('Pago confirmado por ', IF(g.metodo = 'paypal', 'PayPal', 'Stripe'), ' (', g.payment_intent_id, ')'), g.fecha_pago
  FROM pedidos_db.pedidos p JOIN pagos_db.pagos g ON g.id_pedido = p.id AND g.estado = 'confirmado'
 WHERE NOT EXISTS (SELECT 1 FROM pedidos_db.historial_estados h WHERE h.pedido_id = p.id)
UNION ALL
SELECT p.id, 'pagado', 'preparando', @admin, NULL, p.fecha + INTERVAL 4 HOUR
  FROM pedidos_db.pedidos p WHERE p.estado IN ('preparando', 'enviado', 'entregado')
   AND NOT EXISTS (SELECT 1 FROM pedidos_db.historial_estados h WHERE h.pedido_id = p.id)
UNION ALL
SELECT p.id, 'preparando', 'enviado', @admin, 'Sale con la ruta de entregas del día', p.fecha + INTERVAL 1 DAY
  FROM pedidos_db.pedidos p WHERE p.estado IN ('enviado', 'entregado') AND p.metodo_entrega = 'domicilio'
   AND NOT EXISTS (SELECT 1 FROM pedidos_db.historial_estados h WHERE h.pedido_id = p.id)
UNION ALL
SELECT p.id, IF(p.metodo_entrega = 'domicilio', 'enviado', 'preparando'), 'entregado', @admin,
       IF(p.metodo_entrega = 'domicilio', 'Entregado en la dirección del cliente', 'Retirado en la sede'), p.fecha + INTERVAL 2 DAY
  FROM pedidos_db.pedidos p WHERE p.estado = 'entregado'
   AND NOT EXISTS (SELECT 1 FROM pedidos_db.historial_estados h WHERE h.pedido_id = p.id)
UNION ALL
SELECT p.id, 'pendiente_pago', 'cancelado', NULL, 'Vencido: 24 h sin pago', p.fecha + INTERVAL 24 HOUR
  FROM pedidos_db.pedidos p WHERE p.estado = 'cancelado'
   AND NOT EXISTS (SELECT 1 FROM pedidos_db.historial_estados h WHERE h.pedido_id = p.id);

-- ---------- Resumen ----------
SELECT 'clientes' AS dato, COUNT(*) AS total FROM auth_db.usuarios WHERE rol = 'cliente'
UNION ALL SELECT 'mascotas', COUNT(*) FROM citas_db.mascotas
UNION ALL SELECT 'citas', COUNT(*) FROM citas_db.citas
UNION ALL SELECT 'consultas en historial', COUNT(*) FROM citas_db.historial_clinico
UNION ALL SELECT 'vacunas', COUNT(*) FROM citas_db.vacunas
UNION ALL SELECT 'pedidos', COUNT(*) FROM pedidos_db.pedidos
UNION ALL SELECT 'pagos', COUNT(*) FROM pagos_db.pagos;
