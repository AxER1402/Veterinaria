-- Datos de demostración (ficticios pero coherentes): reseñas de clientes de la demo sobre productos
-- que compraron y les llegaron (pedidos entregados), mencionando a sus mascotas de la demo.
-- Se puede correr más de una vez: la reseña de cada cliente y producto se actualiza.
USE catalogo_db;
CREATE TEMPORARY TABLE tmp_resenas (
    email       VARCHAR(120) NOT NULL,
    slug        VARCHAR(160) NOT NULL,
    estrellas   TINYINT NOT NULL,
    comentario  VARCHAR(600) NOT NULL,
    dias        SMALLINT NOT NULL
);
INSERT INTO tmp_resenas (email, slug, estrellas, comentario, dias) VALUES
 ('mariajose.lopez@example.com',  'alimento-seco-pollo-arroz',    5, 'Luna es muy delicada del estómago y con este alimento dejó de tener gases. Ya vamos por el segundo saco.', 20),
 ('mariajose.lopez@example.com',  'croquetas-gato-salmon',        4, 'A Michi le encantan y casi no ha vuelto a vomitar bolas de pelo. Le quito una estrella porque la bolsa pequeña se acaba rápido.', 18),
 ('gabriela.ramirez@example.com', 'shampoo-avena-perro',          5, 'Toby tiene dermatitis y en la clínica nos recomendaron este shampoo. No le irrita la piel y huele suave. Lo bañamos cada 10 días.', 12),
 ('gabriela.ramirez@example.com', 'panoleta-bandana',             4, 'Bonita y de buena tela. A Toby le quedó un poco grande: mejor pedir la talla menor.', 12),
 ('analucia.perez@example.com',   'alimento-humedo-gato-pollo',   5, 'Nube casi no tomaba agua y con este húmedo se hidrata mejor. Se ven los trozos de pollo de verdad.', 9),
 ('analucia.perez@example.com',   'arena-aglomerante-gato',       4, 'Hace bloques firmes y casi no levanta polvo. En un apartamento pequeño se nota que controla el olor.', 9),
 ('carlos.mendez@example.com',    'tiras-res-deshidratadas',      5, 'Rocky ya no es un cachorro y le cuesta subir gradas. Se las doy de premio todos los días y las espera con ansias.', 25),
 ('carlos.mendez@example.com',    'mix-crudo-liofilizado-res',    4, 'Lo mezclo con sus croquetas y se come todo. Rinde bien, aunque el precio es algo alto.', 25),
 ('cliente@huellitas.gt',         'alimento-seco-pollo-arroz',    4, 'Bruno lo come bien. Al principio lo mezclé con su alimento anterior durante una semana para que se acostumbrara.', 30),
 ('cliente@huellitas.gt',         'galletas-mantequilla-mani',    5, 'Las uso de premio para entrenar a Bruno: se parten fácil en pedacitos y no dejan las manos grasosas.', 30),
 ('cliente@huellitas.gt',         'alimento-humedo-gato-pollo',   5, 'Mía es exigente con la comida y este sí se lo come completo.', 6),
 ('cliente@huellitas.gt',         'arena-aglomerante-gato',       5, 'La mejor arena que he probado: rinde mucho y no se pega en el arenero.', 6),
 ('diego.morales@example.com',    'heno-timothy-conejo',          5, 'Coco lo prefiere a cualquier otro heno. Viene verde, oloroso y con poco polvo.', 15),
 ('diego.morales@example.com',    'rueda-silenciosa',             3, 'Es muy silenciosa, pero es para hámster y Coco es demasiado grande. Se la regalé a mi sobrina para su hámster y le encanta.', 15);

-- Solo si el cliente tiene un pedido entregado con ese producto (como exige la tienda).
INSERT INTO catalogo_db.resenas (producto_id, id_cliente, autor, calificacion, comentario, visible, revisada, created_at)
SELECT DISTINCT p.id, u.id,
       CONCAT(SUBSTRING_INDEX(u.nombre, ' ', 1), ' ', LEFT(SUBSTRING_INDEX(SUBSTRING_INDEX(u.nombre, ' ', 2), ' ', -1), 1), '.'),
       t.estrellas, t.comentario, 1, 1, NOW() - INTERVAL t.dias DAY
  FROM tmp_resenas t
  JOIN auth_db.usuarios u ON u.email = t.email
  JOIN catalogo_db.productos p ON p.slug = t.slug
 WHERE EXISTS (SELECT 1 FROM pedidos_db.pedidos pe JOIN pedidos_db.detalle_pedidos d ON d.pedido_id = pe.id
                WHERE pe.id_cliente = u.id AND d.producto_id = p.id AND pe.estado = 'entregado')
ON DUPLICATE KEY UPDATE calificacion = VALUES(calificacion), comentario = VALUES(comentario), autor = VALUES(autor),
                        visible = 1, revisada = 1, created_at = VALUES(created_at);

UPDATE catalogo_db.productos p
   SET p.calificacion = COALESCE((SELECT ROUND(AVG(r.calificacion), 1) FROM catalogo_db.resenas r WHERE r.producto_id = p.id AND r.visible = 1), 0),
       p.resenas      = (SELECT COUNT(*) FROM catalogo_db.resenas r WHERE r.producto_id = p.id AND r.visible = 1);

SELECT 'reseñas publicadas' AS dato, COUNT(*) AS total FROM catalogo_db.resenas WHERE visible = 1
UNION ALL SELECT 'productos con reseñas', COUNT(*) FROM catalogo_db.productos WHERE resenas > 0;
