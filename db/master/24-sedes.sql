-- citas-service · sedes y horarios administrables desde el panel. Antes estaban escritos en el código y
-- la base solo aceptaba tres sedes. El texto «nombre · dirección» sigue igual en correos y pedidos.
-- Sin DELETE: una sede se desactiva y un día cerrado es una fila con «abre» en NULL.
-- Idempotente: ops/migrar-v2.sh lo aplica también a una base ya creada.
USE citas_db;

CREATE TABLE IF NOT EXISTS sedes (
    codigo       VARCHAR(20) PRIMARY KEY,
    nombre       VARCHAR(80) NOT NULL,
    direccion    VARCHAR(160) NOT NULL,
    telefono     VARCHAR(20) NULL,
    ubicacion    VARCHAR(200) NULL,                 -- lo que se busca en el mapa; sin valor, la dirección
    -- Mascotas atendidas a la vez, sumando todos los servicios por turnos. NULL = automático: 1 si es
    -- la única sede activa; si hay más, lo decide el equipo de cada servicio.
    simultaneas  TINYINT UNSIGNED NULL,
    retiro       TINYINT(1) NOT NULL DEFAULT 1,     -- se pueden retirar aquí los pedidos de la tienda
    activa       TINYINT(1) NOT NULL DEFAULT 1,
    orden        TINYINT UNSIGNED NOT NULL DEFAULT 0,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO sedes (codigo, nombre, direccion, telefono, ubicacion, orden) VALUES
    ('centro', 'Clínica veterinaria y peluquería', '6a. avenida 9-35, zona 10', '+502 2385-6420', '6a. avenida 9-35, zona 10, Ciudad de Guatemala', 1),
    ('norte',  'Guardería y hospedaje – Norte', 'Calzada José Milla y Vidaurre 10-55, zona 6', '+502 2385-6420', 'Calzada José Milla y Vidaurre 10-55, zona 6, Ciudad de Guatemala', 2),
    ('sur',    'Paseadores y cuidadores – Sur', 'Calzada Aguilar Batres 34-70, zona 11', '+502 2385-6420', 'Calzada Aguilar Batres 34-70, zona 11, Ciudad de Guatemala', 3);

-- 1 = lunes … 7 = domingo. El horario de siempre: lunes a sábado de 8:00 a 20:00.
CREATE TABLE IF NOT EXISTS sede_horarios (
    sede    VARCHAR(20) NOT NULL,
    dia     TINYINT UNSIGNED NOT NULL,
    abre    TIME NULL,
    cierra  TIME NULL,
    PRIMARY KEY (sede, dia),
    CONSTRAINT fk_horarios_sede FOREIGN KEY (sede) REFERENCES sedes (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO sede_horarios (sede, dia, abre, cierra)
SELECT s.codigo, d.dia, IF(d.dia = 7, NULL, '08:00:00'), IF(d.dia = 7, NULL, '20:00:00')
  FROM sedes s JOIN (SELECT 1 AS dia UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7) d;

ALTER TABLE servicios MODIFY COLUMN sede VARCHAR(20) NOT NULL;
ALTER TABLE citas MODIFY COLUMN sede VARCHAR(20) NOT NULL;
ALTER TABLE turnos_bloqueados MODIFY COLUMN sede VARCHAR(20) NOT NULL;
ALTER TABLE servicios ADD CONSTRAINT fk_servicios_sede FOREIGN KEY IF NOT EXISTS (sede) REFERENCES sedes (codigo);
ALTER TABLE citas ADD CONSTRAINT fk_citas_sede FOREIGN KEY IF NOT EXISTS (sede) REFERENCES sedes (codigo);
ALTER TABLE turnos_bloqueados ADD CONSTRAINT fk_bloqueos_sede FOREIGN KEY IF NOT EXISTS (sede) REFERENCES sedes (codigo);

-- Para contar las citas de una sede en un turno, sumando todos sus servicios.
CREATE INDEX IF NOT EXISTS ix_citas_sede_turno ON citas (sede, inicio, ocupa);
