-- citas-service · correcciones de la parte clínica. Idempotente: ops/migrar-v2.sh también lo aplica.
USE citas_db;

-- Una cita que nadie cerró no es una falta del cliente hasta que el personal lo confirme.
ALTER TABLE citas ADD COLUMN IF NOT EXISTS cierre_automatico TINYINT(1) NOT NULL DEFAULT 0 AFTER estado;
UPDATE citas c SET c.cierre_automatico = 1
 WHERE c.estado = 'no_asistio'
   AND EXISTS (SELECT 1 FROM historial_citas h
                WHERE h.cita_id = c.id AND h.comentario LIKE 'Cierre automático%'
                  AND h.id = (SELECT MAX(x.id) FROM historial_citas x WHERE x.cita_id = c.id));

-- Firma de la ficha: nombre y colegiado de quien atendió, guardados tal como estaban ese día.
ALTER TABLE profesionales ADD COLUMN IF NOT EXISTS colegiado VARCHAR(20) NULL AFTER nombre;
ALTER TABLE historial_clinico
    ADD COLUMN IF NOT EXISTS registrado_nombre     VARCHAR(100) NULL AFTER registrado_email,
    ADD COLUMN IF NOT EXISTS registrado_colegiado  VARCHAR(20) NULL AFTER registrado_nombre,
    ADD COLUMN IF NOT EXISTS control_aviso_at      DATETIME NULL AFTER proximo_control;
ALTER TABLE historial_adendas
    ADD COLUMN IF NOT EXISTS registrado_nombre     VARCHAR(100) NULL AFTER registrado_email;
CREATE INDEX IF NOT EXISTS ix_historial_control ON historial_clinico (proximo_control);

ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS lote VARCHAR(40) NULL AFTER duracion;
ALTER TABLE mascotas ADD COLUMN IF NOT EXISTS fallecida_el DATE NULL AFTER activa;
