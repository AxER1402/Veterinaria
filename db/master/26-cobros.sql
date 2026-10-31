-- citas-service · cobro de consultas y servicios en mostrador, con su recibo. No es una factura: la
-- factura electrónica (FEL) necesita un certificador contratado. Sin DELETE: un cobro se anula con
-- su motivo. El número es correlativo y puede tener saltos (un cobro anulado conserva el suyo).
-- Idempotente: ops/migrar-v2.sh también lo aplica.
USE citas_db;

CREATE TABLE IF NOT EXISTS cobros (
    id                CHAR(36) PRIMARY KEY,
    numero            INT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
    cita_id           CHAR(36) NULL,
    mascota_id        CHAR(36) NULL,
    id_cliente        INT UNSIGNED NOT NULL,
    cliente_nombre    VARCHAR(100) NOT NULL,
    cliente_email     VARCHAR(120) NULL,
    mascota_nombre    VARCHAR(60) NULL,
    sede              VARCHAR(20) NULL,
    total             DECIMAL(10,2) NOT NULL,
    estado            ENUM('pendiente','pagado','anulado') NOT NULL DEFAULT 'pendiente',
    metodo            ENUM('efectivo','tarjeta','transferencia','otro') NULL,
    referencia        VARCHAR(60) NULL,
    motivo_anulacion  VARCHAR(200) NULL,
    creado_por        INT UNSIGNED NOT NULL,
    creado_email      VARCHAR(120) NOT NULL,
    cobrado_por       INT UNSIGNED NULL,
    cobrado_email     VARCHAR(120) NULL,
    cobrado_at        DATETIME NULL,
    anulado_por       INT UNSIGNED NULL,
    anulado_at        DATETIME NULL,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Una cita tiene un solo cobro vigente; si se anula, se le puede hacer otro.
    vigente           TINYINT AS (IF(estado = 'anulado', NULL, 1)) PERSISTENT,
    UNIQUE KEY uq_cobros_cita (cita_id, vigente),
    KEY ix_cobros_cliente (id_cliente, created_at),
    KEY ix_cobros_cobrado (cobrado_at),
    KEY ix_cobros_estado (estado, created_at),
    CONSTRAINT ck_cobros_total CHECK (total > 0),
    CONSTRAINT fk_cobros_cita FOREIGN KEY (cita_id) REFERENCES citas (id),
    CONSTRAINT fk_cobros_mascota FOREIGN KEY (mascota_id) REFERENCES mascotas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cobro_lineas (
    id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cobro_id         CHAR(36) NOT NULL,
    concepto         VARCHAR(120) NOT NULL,
    cantidad         SMALLINT UNSIGNED NOT NULL,
    precio_unitario  DECIMAL(10,2) NOT NULL,
    subtotal         DECIMAL(10,2) NOT NULL,
    KEY ix_lineas_cobro (cobro_id),
    CONSTRAINT fk_lineas_cobro FOREIGN KEY (cobro_id) REFERENCES cobros (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
