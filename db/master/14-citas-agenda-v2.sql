-- citas-service · agenda v2: cupos por servicio, guardería por día, hospedaje por estadía,
-- más datos de la mascota y adjuntos del historial.
-- Idempotente: ops/migrar-v2.sh lo aplica también a una base ya creada.
USE citas_db;

-- Cada servicio tiene sus propios cupos: la peluquería ya no le quita lugar a la consulta.
--   turno   → turnos de 30 min (cupos = consultorios, mesas o paseadores)
--   dia     → un cupo por día, con entrada a las 8:00 (guardería)
--   estadia → entrada y salida; los cupos son por noche (hospedaje)
ALTER TABLE servicios
    ADD COLUMN IF NOT EXISTS modalidad ENUM('turno','dia','estadia') NOT NULL DEFAULT 'turno' AFTER sede,
    ADD COLUMN IF NOT EXISTS cupos TINYINT UNSIGNED NOT NULL DEFAULT 2 AFTER modalidad;
UPDATE servicios SET modalidad = 'turno', cupos = 2 WHERE slug IN ('veterinaria', 'peluqueria');
UPDATE servicios SET modalidad = 'turno', cupos = 3 WHERE slug = 'paseos';
UPDATE servicios SET modalidad = 'turno', cupos = 1 WHERE slug = 'entrenamiento';
UPDATE servicios SET modalidad = 'dia', cupos = 15 WHERE slug = 'guarderia';
UPDATE servicios SET modalidad = 'estadia', cupos = 10 WHERE slug = 'hospedaje';

-- Salida del hospedaje (NULL en el resto).
ALTER TABLE citas ADD COLUMN IF NOT EXISTS fin DATETIME NULL AFTER inicio;

-- La doble reserva la sigue impidiendo la BD, ahora por servicio y no por sede.
ALTER TABLE citas DROP INDEX IF EXISTS uq_citas_turno;
CREATE UNIQUE INDEX IF NOT EXISTS uq_citas_servicio ON citas (servicio, inicio, cupo, ocupa);

ALTER TABLE mascotas
    MODIFY COLUMN especie ENUM('perro','gato','conejo','ave','roedor','reptil','otro') NOT NULL,
    ADD COLUMN IF NOT EXISTS esterilizado TINYINT(1) NULL AFTER sexo,
    ADD COLUMN IF NOT EXISTS color        VARCHAR(40) NULL AFTER esterilizado,
    ADD COLUMN IF NOT EXISTS microchip    VARCHAR(20) NULL AFTER color;

-- Resultados de laboratorio y radiografías: el archivo vive en Cloudinary como privado y solo se
-- descarga con un enlace firmado que genera citas-service (dato de salud, A.5.34).
CREATE TABLE IF NOT EXISTS historial_adjuntos (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    historial_id    CHAR(36) NOT NULL,
    nombre          VARCHAR(120) NOT NULL,
    tipo            ENUM('laboratorio','radiografia','otro') NOT NULL DEFAULT 'otro',
    public_id       VARCHAR(200) NOT NULL,
    recurso         VARCHAR(10) NOT NULL,   -- image | raw (PDF y otros)
    formato         VARCHAR(10) NULL,
    registrado_por  INT UNSIGNED NOT NULL,
    registrado_email VARCHAR(120) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_adjuntos_historial (historial_id),
    CONSTRAINT fk_adjuntos_historial FOREIGN KEY (historial_id) REFERENCES historial_clinico (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
