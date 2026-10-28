-- citas-service · cupos por profesional: cada veterinario (o peluquero, paseador…) con sus días y horario.
-- En un servicio con profesionales, el «cupo» de la cita es el id del profesional: el índice único
-- uq_citas_servicio (servicio, inicio, cupo) impide darle dos citas a la vez a la misma persona.
-- Un servicio sin profesionales sigue con cupos numéricos (servicios.cupos).
-- Idempotente: ops/migrar-v2.sh lo aplica también a una base ya creada.
USE citas_db;

CREATE TABLE IF NOT EXISTS profesionales (
    id           TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    servicio     VARCHAR(30) NOT NULL,
    nombre       VARCHAR(80) NOT NULL,
    usuario_id   INT UNSIGNED NULL,                    -- su cuenta en auth_db (rol veterinario), si tiene
    dias         VARCHAR(13) NOT NULL DEFAULT '1,2,3,4,5,6',   -- 1 = lunes … 6 = sábado
    hora_inicio  TIME NOT NULL DEFAULT '08:00:00',
    hora_fin     TIME NOT NULL DEFAULT '20:00:00',
    activo       TINYINT(1) NOT NULL DEFAULT 1,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_profesionales_servicio (servicio, activo),
    CONSTRAINT fk_profesionales_servicio FOREIGN KEY (servicio) REFERENCES servicios (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Los dos consultorios de siempre pasan a ser dos veterinarios (ids 1 y 2 = los cupos 1 y 2 de las
-- citas que ya existían, así ninguna queda sin dueño). Horario completo: la agenda no cambia.
INSERT IGNORE INTO profesionales (id, servicio, nombre, usuario_id) VALUES
    (1, 'veterinaria', 'Dra. Andrea Morales', (SELECT id FROM auth_db.usuarios WHERE email = 'veterinaria@huellitas.gt')),
    (2, 'veterinaria', 'Dr. Luis Pérez', NULL);
