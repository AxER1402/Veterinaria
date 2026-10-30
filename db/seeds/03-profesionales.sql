-- Datos de demostración: equipo de peluquería, paseos y entrenamiento.
-- Antes solo la consulta veterinaria tenía profesionales; los otros servicios por turnos usaban un
-- número fijo de lugares (servicios.cupos). Con profesionales, el lugar de cada turno es una persona
-- y la capacidad pasa a ser cuántos trabajan a esa hora. Se carga la misma cantidad que los lugares
-- de antes (peluquería 2, paseos 3, entrenamiento 1), así la agenda no pierde capacidad.
-- Se puede correr más de una vez: no duplica profesionales ni vuelve a mover citas.
USE citas_db;

-- La primera persona de cada servicio trabaja el horario completo: recibe las citas que ya existían.
INSERT INTO profesionales (servicio, nombre, dias, hora_inicio, hora_fin)
SELECT n.servicio, n.nombre, n.dias, n.hora_inicio, n.hora_fin
FROM (
    SELECT 1 AS orden, 'peluqueria' AS servicio, 'Karla Juárez' AS nombre, '1,2,3,4,5,6' AS dias, '08:00:00' AS hora_inicio, '20:00:00' AS hora_fin
    UNION ALL SELECT 2, 'peluqueria',    'Mónica Estrada',    '2,3,4,5,6',   '10:00:00', '18:00:00'
    UNION ALL SELECT 3, 'paseos',        'Kevin Rodas',       '1,2,3,4,5,6', '08:00:00', '20:00:00'
    UNION ALL SELECT 4, 'paseos',        'Andrés Batz',       '1,2,3,4,5',   '08:00:00', '14:00:00'
    UNION ALL SELECT 5, 'paseos',        'Fernanda Coy',      '3,4,5,6',     '14:00:00', '20:00:00'
    UNION ALL SELECT 6, 'entrenamiento', 'Óscar Monterroso',  '1,2,3,4,5,6', '08:00:00', '20:00:00'
) n
WHERE NOT EXISTS (SELECT 1 FROM profesionales p WHERE p.servicio = n.servicio AND p.nombre = n.nombre)
ORDER BY n.orden;

-- Citas de esos servicios que todavía tienen un lugar numérico (1, 2, 3…): el lugar k pasa a la
-- k-ésima persona del servicio. Así ninguna cita queda sin asignar y no se pisan dos en el mismo turno.
UPDATE citas c
JOIN (SELECT id, servicio, ROW_NUMBER() OVER (PARTITION BY servicio ORDER BY id) AS n
      FROM profesionales WHERE servicio IN ('peluqueria', 'paseos', 'entrenamiento')) p
  ON p.servicio = c.servicio AND p.n = c.cupo
SET c.cupo = p.id
WHERE c.servicio IN ('peluqueria', 'paseos', 'entrenamiento')
  AND c.cupo NOT IN (SELECT id FROM profesionales WHERE servicio = c.servicio);

SELECT p.servicio, p.nombre, p.dias, LEFT(p.hora_inicio, 5) AS desde, LEFT(p.hora_fin, 5) AS hasta,
       (SELECT COUNT(*) FROM citas c WHERE c.servicio = p.servicio AND c.cupo = p.id) AS citas
FROM profesionales p ORDER BY p.servicio, p.id;
