-- citas-service · FASE 15 B1: historial clínico y carné de vacunas.
-- A.5.34: datos de salud de la mascota; solo los ven el dueño (carné) y el admin (historial).
-- Idempotente: ops/migrar-citas.sh lo aplica también a una base ya creada.
USE citas_db;

-- Una ficha por consulta atendida.
CREATE TABLE IF NOT EXISTS historial_clinico (
    id              CHAR(36) PRIMARY KEY,
    cita_id         CHAR(36) NOT NULL,
    mascota_id      CHAR(36) NOT NULL,
    peso_kg         DECIMAL(5,2) NULL,
    diagnostico     VARCHAR(500) NOT NULL,
    tratamiento     VARCHAR(500) NULL,
    registrado_por  INT UNSIGNED NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_historial_cita (cita_id),
    KEY ix_historial_mascota (mascota_id, created_at),
    CONSTRAINT fk_historial_cita FOREIGN KEY (cita_id) REFERENCES citas (id),
    CONSTRAINT fk_historial_mascota FOREIGN KEY (mascota_id) REFERENCES mascotas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Carné: vacunas aplicadas y la próxima dosis (C1 avisa 7 días antes).
CREATE TABLE IF NOT EXISTS vacunas (
    id                CHAR(36) PRIMARY KEY,
    mascota_id        CHAR(36) NOT NULL,
    historial_id      CHAR(36) NOT NULL,
    nombre            VARCHAR(80) NOT NULL,
    lote              VARCHAR(40) NULL,
    fecha_aplicacion  DATE NOT NULL,
    proxima_dosis     DATE NULL,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_vacunas_mascota (mascota_id, fecha_aplicacion),
    KEY ix_vacunas_proxima (proxima_dosis),
    CONSTRAINT fk_vacunas_mascota FOREIGN KEY (mascota_id) REFERENCES mascotas (id),
    CONSTRAINT fk_vacunas_historial FOREIGN KEY (historial_id) REFERENCES historial_clinico (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
