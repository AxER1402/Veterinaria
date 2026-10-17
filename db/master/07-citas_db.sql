-- citas-service · citas_db
-- Mascotas de cada cliente y citas de la clínica, guardería y paseos.
-- I de STRIDE: mascotas y citas usan UUID (nada de IDs secuenciales que se puedan enumerar).
-- Idempotente (IF NOT EXISTS / INSERT IGNORE) para poder aplicarlo a una base ya creada (ops/migrar-citas.sh).
USE citas_db;

-- Servicios que se agendan y la sede donde se prestan. Cada turno dura 30 min
-- (en guardería y hospedaje es la hora de entrada).
CREATE TABLE IF NOT EXISTS servicios (
    slug          VARCHAR(30) PRIMARY KEY,
    nombre        VARCHAR(80) NOT NULL,
    sede          ENUM('centro','norte','sur') NOT NULL,
    precio_desde  DECIMAL(10,2) NOT NULL,
    activo        TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO servicios (slug, nombre, sede, precio_desde) VALUES
    ('veterinaria',   'Consulta veterinaria', 'centro', 35.00),
    ('peluqueria',    'Peluquería',           'centro', 30.00),
    ('guarderia',     'Guardería',            'norte',  28.00),
    ('hospedaje',     'Hospedaje',            'norte',  45.00),
    ('paseos',        'Paseos',               'sur',    18.00),
    ('entrenamiento', 'Entrenamiento',        'sur',    40.00);

-- A.5.34: solo lo necesario para atender a la mascota.
CREATE TABLE IF NOT EXISTS mascotas (
    id                CHAR(36) PRIMARY KEY,
    id_cliente        INT UNSIGNED NOT NULL,
    nombre            VARCHAR(60) NOT NULL,
    especie           ENUM('perro','gato','otro') NOT NULL,
    raza              VARCHAR(60) NULL,
    sexo              ENUM('macho','hembra') NULL,
    fecha_nacimiento  DATE NULL,
    peso_kg           DECIMAL(5,2) NULL,
    notas             VARCHAR(300) NULL,      -- alergias, temperamento…
    activa            TINYINT(1) NOT NULL DEFAULT 1,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY ix_mascotas_cliente (id_cliente, activa)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS citas (
    id              CHAR(36) PRIMARY KEY,
    id_cliente      INT UNSIGNED NOT NULL,
    mascota_id      CHAR(36) NOT NULL,
    servicio        VARCHAR(30) NOT NULL,
    sede            ENUM('centro','norte','sur') NOT NULL,
    inicio          DATETIME NOT NULL,
    cupo            TINYINT UNSIGNED NOT NULL,          -- consultorio / cuidador (1..CUPOS)
    estado          ENUM('pendiente','confirmada','atendida','no_asistio','cancelada') NOT NULL DEFAULT 'pendiente',
    cliente_nombre  VARCHAR(100) NOT NULL,
    cliente_email   VARCHAR(120) NOT NULL,
    telefono        VARCHAR(20) NOT NULL,
    notas           VARCHAR(300) NULL,
    -- NULL si está cancelada: el índice único ignora los NULL, así el cupo se libera.
    ocupa           TINYINT AS (IF(estado = 'cancelada', NULL, 1)) PERSISTENT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- Sin doble reserva aunque dos clientes pidan el mismo turno a la vez: lo decide la BD.
    UNIQUE KEY uq_citas_turno (sede, inicio, cupo, ocupa),
    UNIQUE KEY uq_citas_mascota (mascota_id, inicio, ocupa),
    KEY ix_citas_cliente (id_cliente, inicio),
    KEY ix_citas_agenda (inicio, sede),
    CONSTRAINT fk_citas_mascota FOREIGN KEY (mascota_id) REFERENCES mascotas (id),
    CONSTRAINT fk_citas_servicio FOREIGN KEY (servicio) REFERENCES servicios (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS historial_citas (
    id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cita_id          CHAR(36) NOT NULL,
    estado_anterior  VARCHAR(20) NULL,
    estado_nuevo     VARCHAR(20) NOT NULL,
    cambiado_por     INT UNSIGNED NULL,       -- NULL = sistema (recordatorios)
    comentario       VARCHAR(200) NULL,
    fecha            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_historial_cita (cita_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Feriados o mantenimiento: sin hora = el día entero.
CREATE TABLE IF NOT EXISTS turnos_bloqueados (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sede         ENUM('centro','norte','sur') NOT NULL,
    fecha        DATE NOT NULL,
    hora_inicio  TIME NULL,
    hora_fin     TIME NULL,
    motivo       VARCHAR(120) NOT NULL,
    creado_por   INT UNSIGNED NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_bloqueos (sede, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
