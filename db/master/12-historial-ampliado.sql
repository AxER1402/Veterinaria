-- citas-service · historial clínico ampliado: pacientes, consultas sin cita, examen físico,
-- medicamentos, adendas, vacunas de otra clínica, desparasitaciones y notas de servicios no clínicos.
-- A.5.34: siguen siendo datos de salud; solo el admin ve el historial y el dueño solo el carné.
-- Idempotente: ops/migrar-citas.sh lo aplica también a una base ya creada.
USE citas_db;

-- Alergias y enfermedades crónicas en campos propios (antes iban mezcladas en «notas»).
ALTER TABLE mascotas
    ADD COLUMN IF NOT EXISTS alergias               VARCHAR(300) NULL AFTER peso_kg,
    ADD COLUMN IF NOT EXISTS enfermedades_cronicas  VARCHAR(300) NULL AFTER alergias;

-- Una ficha puede no tener cita (urgencias, gente que llega sin cita): cita_id pasa a NULL y la
-- fecha de la consulta se guarda en la ficha. El índice único sigue impidiendo dos fichas por cita.
ALTER TABLE historial_clinico
    MODIFY COLUMN cita_id CHAR(36) NULL,
    MODIFY COLUMN diagnostico VARCHAR(1000) NOT NULL,
    ADD COLUMN IF NOT EXISTS fecha                    DATETIME NULL AFTER mascota_id,
    ADD COLUMN IF NOT EXISTS motivo                   VARCHAR(200) NULL AFTER fecha,
    ADD COLUMN IF NOT EXISTS anamnesis                VARCHAR(1000) NULL AFTER motivo,
    ADD COLUMN IF NOT EXISTS temperatura_c            DECIMAL(3,1) NULL AFTER peso_kg,
    ADD COLUMN IF NOT EXISTS frecuencia_cardiaca      SMALLINT UNSIGNED NULL AFTER temperatura_c,
    ADD COLUMN IF NOT EXISTS frecuencia_respiratoria  SMALLINT UNSIGNED NULL AFTER frecuencia_cardiaca,
    ADD COLUMN IF NOT EXISTS mucosas                  VARCHAR(20) NULL AFTER frecuencia_respiratoria,
    ADD COLUMN IF NOT EXISTS hidratacion              VARCHAR(20) NULL AFTER mucosas,
    ADD COLUMN IF NOT EXISTS condicion_corporal       TINYINT UNSIGNED NULL AFTER hidratacion,  -- escala 1 a 9
    ADD COLUMN IF NOT EXISTS indicaciones             VARCHAR(1000) NULL AFTER tratamiento,
    ADD COLUMN IF NOT EXISTS proximo_control          DATE NULL AFTER indicaciones,
    ADD COLUMN IF NOT EXISTS registrado_email         VARCHAR(120) NULL AFTER registrado_por;

UPDATE historial_clinico h JOIN citas c ON c.id = h.cita_id SET h.fecha = c.inicio WHERE h.fecha IS NULL;
UPDATE historial_clinico SET fecha = created_at WHERE fecha IS NULL;
ALTER TABLE historial_clinico MODIFY COLUMN fecha DATETIME NOT NULL;
CREATE INDEX IF NOT EXISTS ix_historial_fecha ON historial_clinico (mascota_id, fecha);

CREATE TABLE IF NOT EXISTS medicamentos (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    historial_id  CHAR(36) NOT NULL,
    nombre        VARCHAR(80) NOT NULL,
    dosis         VARCHAR(60) NULL,
    frecuencia    VARCHAR(60) NULL,
    duracion      VARCHAR(60) NULL,
    KEY ix_medicamentos_historial (historial_id),
    CONSTRAINT fk_medicamentos_historial FOREIGN KEY (historial_id) REFERENCES historial_clinico (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Una ficha guardada no se edita ni se borra: se corrige con una adenda que queda a la vista.
CREATE TABLE IF NOT EXISTS historial_adendas (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    historial_id      CHAR(36) NOT NULL,
    texto             VARCHAR(1000) NOT NULL,
    registrado_por    INT UNSIGNED NOT NULL,
    registrado_email  VARCHAR(120) NULL,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_adendas_historial (historial_id),
    CONSTRAINT fk_adendas_historial FOREIGN KEY (historial_id) REFERENCES historial_clinico (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vacunas de otra clínica (sin ficha) y desparasitaciones en el mismo carné, separadas por tipo.
ALTER TABLE vacunas
    MODIFY COLUMN historial_id CHAR(36) NULL,
    ADD COLUMN IF NOT EXISTS tipo             ENUM('vacuna','desparasitacion') NOT NULL DEFAULT 'vacuna' AFTER historial_id,
    ADD COLUMN IF NOT EXISTS clinica_externa  VARCHAR(100) NULL AFTER proxima_dosis,
    ADD COLUMN IF NOT EXISTS registrado_por   INT UNSIGNED NULL AFTER clinica_externa;
UPDATE vacunas SET tipo = 'desparasitacion' WHERE tipo = 'vacuna' AND nombre LIKE 'Desparasita%';

-- Observaciones de peluquería, guardería, paseos…: «en peluquería se le encontró otitis».
CREATE TABLE IF NOT EXISTS notas_servicio (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cita_id           CHAR(36) NOT NULL,
    mascota_id        CHAR(36) NOT NULL,
    texto             VARCHAR(500) NOT NULL,
    registrado_por    INT UNSIGNED NOT NULL,
    registrado_email  VARCHAR(120) NULL,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_notas_mascota (mascota_id, created_at),
    CONSTRAINT fk_notas_cita FOREIGN KEY (cita_id) REFERENCES citas (id),
    CONSTRAINT fk_notas_mascota FOREIGN KEY (mascota_id) REFERENCES mascotas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
