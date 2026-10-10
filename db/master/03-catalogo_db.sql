-- catalogo-service · catalogo_db
-- Generado a partir del catálogo del frontend (24 productos). Precio y stock viven en producto_variantes.
USE catalogo_db;

CREATE TABLE categorias (
    id      TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    slug    VARCHAR(40) NOT NULL UNIQUE,
    nombre  VARCHAR(60) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE productos (
    id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    slug              VARCHAR(120) NOT NULL UNIQUE,
    nombre            VARCHAR(150) NOT NULL,
    marca             VARCHAR(60)  NOT NULL,
    mascota           VARCHAR(20)  NOT NULL,
    categoria_id      TINYINT UNSIGNED NOT NULL,
    descripcion       TEXT NOT NULL,
    imagen_url        VARCHAR(500) NOT NULL,       -- se sirve vía CDN Cloudinary
    imagen_public_id  VARCHAR(200) NULL,           -- id de Cloudinary si se subió por upload firmado
    calificacion      DECIMAL(2,1) NOT NULL DEFAULT 0,
    resenas           INT UNSIGNED NOT NULL DEFAULT 0,
    etiqueta          VARCHAR(40) NULL,
    destacado         TINYINT(1) NOT NULL DEFAULT 0,
    activo            TINYINT(1) NOT NULL DEFAULT 1,
    updated_by        INT UNSIGNED NULL,           -- id del admin (auth_db.usuarios)
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_productos_categoria FOREIGN KEY (categoria_id) REFERENCES categorias (id),
    KEY ix_productos_mascota (mascota)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE producto_variantes (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    producto_id      INT UNSIGNED NOT NULL,
    etiqueta         VARCHAR(40) NOT NULL,
    sku              VARCHAR(40) NOT NULL UNIQUE,
    precio           DECIMAL(10,2) NOT NULL,
    precio_anterior  DECIMAL(10,2) NULL,
    stock            INT UNSIGNED NOT NULL DEFAULT 0,
    updated_by       INT UNSIGNED NULL,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_variantes_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
    CONSTRAINT ck_variantes_precio CHECK (precio > 0 AND (precio_anterior IS NULL OR precio_anterior > precio)),
    UNIQUE KEY uq_variante (producto_id, etiqueta)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stock apartado por cada pedido: evita descontar dos veces el mismo pedido (idempotencia).
CREATE TABLE reservas_stock (
    pedido_id    CHAR(36) NOT NULL,
    variante_id  INT UNSIGNED NOT NULL,
    cantidad     INT UNSIGNED NOT NULL,
    estado       ENUM('reservada','liberada') NOT NULL DEFAULT 'reservada',
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (pedido_id, variante_id),
    CONSTRAINT fk_reservas_variante FOREIGN KEY (variante_id) REFERENCES producto_variantes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO categorias (slug, nombre) VALUES
  ('alimento', 'Alimento'),
  ('snacks', 'Snacks y premios'),
  ('juguetes', 'Juguetes'),
  ('accesorios', 'Accesorios');

INSERT INTO productos (id, slug, nombre, marca, mascota, categoria_id, descripcion, imagen_url, calificacion, resenas, etiqueta, destacado) VALUES
  (1, 'alimento-seco-pollo-arroz', 'Alimento seco Grain Free de pollo y arroz integral', 'NutriHuella', 'perro', (SELECT id FROM categorias WHERE slug = 'alimento'), 'Receta sin granos con pollo deshuesado como primer ingrediente, arroz integral y vegetales. Rica en proteína, omega 3 y 6 para un pelaje brillante y una digestión saludable.', 'https://images.unsplash.com/photo-1764249453850-faace6e57444?auto=format&fit=crop&w=600&h=600&q=75', 4.8, 214, 'Más vendido', 1),
  (2, 'mix-crudo-liofilizado-res', 'Topper crudo liofilizado de res para mezclar', 'Bosque Salvaje', 'perro', (SELECT id FROM categorias WHERE slug = 'alimento'), 'Trocitos de res cruda liofilizada que se mezclan con su alimento habitual. Aportan sabor y nutrientes naturales sin conservantes artificiales.', 'https://images.unsplash.com/photo-1745252798506-29500efc5b39?auto=format&fit=crop&w=600&h=600&q=75', 4.7, 96, NULL, 1),
  (3, 'galletas-mantequilla-mani', 'Galletas horneadas de mantequilla de maní', 'Bocadito', 'perro', (SELECT id FROM categorias WHERE slug = 'snacks'), 'Galletas crujientes en forma de hueso horneadas en pequeños lotes con mantequilla de maní natural y avena. Perfectas como premio de entrenamiento.', 'https://images.unsplash.com/photo-1568640347023-a616a30bc3bd?auto=format&fit=crop&w=600&h=600&q=75', 4.9, 158, 'Oferta', 1),
  (4, 'tiras-res-deshidratadas', 'Tiras de res deshidratadas para cadera y articulaciones', 'Bosque Salvaje', 'perro', (SELECT id FROM categorias WHERE slug = 'snacks'), 'Jerky de res de un solo ingrediente enriquecido con glucosamina y condroitina. Ideal para perros activos y senior.', 'https://images.unsplash.com/photo-1650453208424-bb782a8168fd?auto=format&fit=crop&w=600&h=600&q=75', 4.6, 71, NULL, 1),
  (5, 'correa-collar-reflectivo', 'Set de collar y correa reflectivos', 'NutriHuella', 'perro', (SELECT id FROM categorias WHERE slug = 'accesorios'), 'Nylon resistente con costuras reflectivas para paseos nocturnos seguros. Hebilla de liberación rápida y argolla de aluminio.', 'https://images.unsplash.com/photo-1751292780915-b718a45b2d50?auto=format&fit=crop&w=600&h=600&q=75', 4.5, 44, NULL, 0),
  (6, 'panoleta-bandana', 'Pañoleta bandana de algodón', 'Bocadito', 'perro', (SELECT id FROM categorias WHERE slug = 'accesorios'), 'Bandana 100% algodón, suave y lavable, con broche ajustable. Para que luzca con estilo en cada paseo.', 'https://images.unsplash.com/photo-1613398394634-bf4ff517f613?auto=format&fit=crop&w=600&h=600&q=75', 4.4, 23, NULL, 0),
  (7, 'sudadera-perro', 'Sudadera con capucha para perro', 'Bocadito', 'perro', (SELECT id FROM categorias WHERE slug = 'accesorios'), 'Sudadera de felpa suave con capucha y abertura para arnés. Mantiene a tu perro abrigado en los días fríos.', 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=600&h=600&q=75', 4.8, 52, 'Nuevo', 1),
  (8, 'sueter-tejido', 'Suéter tejido de cuello alto', 'Bocadito', 'perro', (SELECT id FROM categorias WHERE slug = 'accesorios'), 'Tejido acanalado cálido y elástico. Cuello alto para proteger del frío sin incomodar.', 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=600&h=600&q=75', 4.7, 38, 'Oferta', 0),
  (9, 'alimento-humedo-gato-pollo', 'Alimento húmedo para gato: pechuga de pollo en caldo', 'Gatuno', 'gato', (SELECT id FROM categorias WHERE slug = 'alimento'), 'Trozos de pechuga de pollo real en caldo natural. Alta hidratación y proteína, sin cereales ni colorantes.', 'https://images.unsplash.com/photo-1558993457-4bc6ec2c3734?auto=format&fit=crop&w=600&h=600&q=75', 4.9, 187, NULL, 1),
  (10, 'croquetas-gato-salmon', 'Croquetas para gato adulto sabor salmón', 'Gatuno', 'gato', (SELECT id FROM categorias WHERE slug = 'alimento'), 'Fórmula completa con salmón, taurina y fibra natural para el control de bolas de pelo.', 'https://images.unsplash.com/photo-1596854331442-3cf47265cefb?auto=format&fit=crop&w=600&h=600&q=75', 4.6, 132, NULL, 1),
  (11, 'varita-plumas-gato', 'Varita interactiva con plumas y cascabel', 'Gatuno', 'gato', (SELECT id FROM categorias WHERE slug = 'juguetes'), 'Estimula el instinto cazador de tu gato con plumas naturales y un cascabel. Mango flexible de 60 cm.', 'https://images.unsplash.com/photo-1708979346185-5f3235e1becd?auto=format&fit=crop&w=600&h=600&q=75', 4.8, 89, NULL, 1),
  (12, 'cama-nube-gato', 'Cama acolchada Nube para gato', 'Gatuno', 'gato', (SELECT id FROM categorias WHERE slug = 'accesorios'), 'Cama redonda de peluche extra suave con borde elevado que da sensación de seguridad. Lavable a máquina.', 'https://images.unsplash.com/photo-1719149010221-d76c5a54ab3c?auto=format&fit=crop&w=600&h=600&q=75', 4.9, 64, 'Nuevo', 0),
  (13, 'hojuelas-tropicales', 'Hojuelas tropicales para peces', 'AquaViva', 'peces', (SELECT id FROM categorias WHERE slug = 'alimento'), 'Alimento completo en hojuelas con espirulina que realza el color natural de tus peces.', 'https://images.unsplash.com/photo-1647862622825-97c260fcbc84?auto=format&fit=crop&w=600&h=600&q=75', 4.5, 41, NULL, 0),
  (14, 'kit-acuario-40l', 'Kit de acuario plantado 40 L', 'AquaViva', 'peces', (SELECT id FROM categorias WHERE slug = 'accesorios'), 'Incluye pecera de vidrio, filtro silencioso, iluminación LED y calentador. Todo para empezar tu acuario.', 'https://images.unsplash.com/photo-1750173482965-dd7fec626704?auto=format&fit=crop&w=600&h=600&q=75', 4.7, 27, 'Oferta', 0),
  (15, 'mezcla-semillas-hamster', 'Mezcla gourmet de semillas para hámster', 'Roedor Pro', 'pequenos', (SELECT id FROM categorias WHERE slug = 'alimento'), 'Semillas, granos, frutas deshidratadas y vegetales para una dieta variada y balanceada.', 'https://images.unsplash.com/photo-1618232118117-98d49b20e2f5?auto=format&fit=crop&w=600&h=600&q=75', 4.6, 33, NULL, 0),
  (16, 'rueda-silenciosa', 'Rueda de ejercicio silenciosa', 'Roedor Pro', 'pequenos', (SELECT id FROM categorias WHERE slug = 'juguetes'), 'Rodamiento silencioso y superficie antideslizante para que tu pequeño se ejercite día y noche.', 'https://images.unsplash.com/photo-1425082661705-1834bfd09dca?auto=format&fit=crop&w=600&h=600&q=75', 4.4, 19, NULL, 0),
  (17, 'semillas-periquitos', 'Mezcla de semillas para periquitos', 'PlumaFeliz', 'aves', (SELECT id FROM categorias WHERE slug = 'alimento'), 'Mijo, alpiste y avena seleccionados, enriquecidos con vitaminas y minerales.', 'https://images.unsplash.com/photo-1685790846266-d094716fd3c9?auto=format&fit=crop&w=600&h=600&q=75', 4.7, 28, NULL, 0),
  (18, 'columpio-percha-madera', 'Columpio y percha de madera natural', 'PlumaFeliz', 'aves', (SELECT id FROM categorias WHERE slug = 'juguetes'), 'Madera sin tratar y cuentas de colores para entretener a tu ave y cuidar sus patas.', 'https://images.unsplash.com/photo-1522858547137-f1dcec554f55?auto=format&fit=crop&w=600&h=600&q=75', 4.5, 15, NULL, 0),
  (19, 'grillos-deshidratados', 'Grillos deshidratados para reptiles', 'Escama', 'reptiles', (SELECT id FROM categorias WHERE slug = 'alimento'), 'Fuente natural de proteína para geckos, dragones barbudos y otros insectívoros.', 'https://images.unsplash.com/photo-1762606774489-94d5316024f6?auto=format&fit=crop&w=600&h=600&q=75', 4.3, 12, NULL, 0),
  (20, 'lampara-uvb-terrario', 'Lámpara UVB para terrario', 'Escama', 'reptiles', (SELECT id FROM categorias WHERE slug = 'accesorios'), 'Emite rayos UVB y calor para la síntesis de vitamina D3 y el metabolismo del calcio de tu reptil.', 'https://images.unsplash.com/photo-1565684524075-cd71c584dadc?auto=format&fit=crop&w=600&h=600&q=75', 4.6, 21, NULL, 0),
  (21, 'shampoo-avena-perro', 'Shampoo hipoalergénico de avena para perros', 'NutriHuella', 'perro', (SELECT id FROM categorias WHERE slug = 'accesorios'), 'Limpia sin resecar la piel sensible. Con avena coloidal y aloe vera, pH balanceado para perros.', 'https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?auto=format&fit=crop&w=600&h=600&q=75', 4.6, 48, NULL, 0),
  (22, 'arena-aglomerante-gato', 'Arena aglomerante sin aroma para gatos', 'Gatuno', 'gato', (SELECT id FROM categorias WHERE slug = 'accesorios'), 'Bloques firmes que se retiran fácil, control de olores natural y baja generación de polvo.', 'https://images.unsplash.com/photo-1592194996308-7b43878e84a6?auto=format&fit=crop&w=600&h=600&q=75', 4.7, 133, NULL, 1),
  (23, 'pelota-caucho-indestructible', 'Pelota de caucho natural "indestructible"', 'Bocadito', 'perro', (SELECT id FROM categorias WHERE slug = 'juguetes'), 'Caucho natural resistente a mordidas fuertes; rebota de forma irregular y se puede rellenar con premios.', 'https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?auto=format&fit=crop&w=600&h=600&q=75', 4.4, 77, NULL, 0),
  (24, 'heno-timothy-conejo', 'Heno Timothy premium para conejos y cobayas', 'Roedor Pro', 'pequenos', (SELECT id FROM categorias WHERE slug = 'alimento'), 'Heno de primer corte rico en fibra, esencial para la digestión y el desgaste dental de los roedores.', 'https://images.unsplash.com/photo-1585110396000-c9ffd4e4b308?auto=format&fit=crop&w=600&h=600&q=75', 4.8, 39, 'Nuevo', 0);

INSERT INTO producto_variantes (producto_id, etiqueta, sku, precio, precio_anterior, stock) VALUES
  (1, '2 kg', 'HU-001-1', 19.99, NULL, 27),
  (1, '7 kg', 'HU-001-2', 49.99, NULL, 40),
  (1, '15 kg', 'HU-001-3', 89.99, NULL, 53),
  (2, '250 g', 'HU-002-1', 14.99, NULL, 34),
  (2, '500 g', 'HU-002-2', 24.99, NULL, 47),
  (3, '200 g', 'HU-003-1', 7.99, 9.99, 41),
  (3, '500 g', 'HU-003-2', 14.99, 17.99, 54),
  (4, '150 g', 'HU-004-1', 12.99, NULL, 48),
  (5, 'S', 'HU-005-1', 22.99, NULL, 55),
  (5, 'M', 'HU-005-2', 24.99, NULL, 27),
  (5, 'L', 'HU-005-3', 26.99, NULL, 40),
  (6, 'Única', 'HU-006-1', 8.99, NULL, 21),
  (7, 'S', 'HU-007-1', 29.99, NULL, 28),
  (7, 'M', 'HU-007-2', 29.99, NULL, 41),
  (7, 'L', 'HU-007-3', 32.99, NULL, 54),
  (8, 'S', 'HU-008-1', 34.99, 44.99, 35),
  (8, 'M', 'HU-008-2', 36.99, 46.99, 48),
  (9, 'Pack x6', 'HU-009-1', 14.99, NULL, 42),
  (9, 'Pack x12', 'HU-009-2', 27.99, NULL, 55),
  (10, '1.5 kg', 'HU-010-1', 17.99, NULL, 49),
  (10, '4 kg', 'HU-010-2', 39.99, NULL, 21),
  (11, 'Única', 'HU-011-1', 7.99, NULL, 56),
  (12, '50 cm', 'HU-012-1', 39.99, NULL, 22),
  (13, '50 g', 'HU-013-1', 6.99, NULL, 29),
  (13, '200 g', 'HU-013-2', 15.99, NULL, 42),
  (14, '40 L', 'HU-014-1', 89.99, 109.99, 36),
  (15, '800 g', 'HU-015-1', 8.99, NULL, 43),
  (16, '20 cm', 'HU-016-1', 17.99, NULL, 50),
  (16, '28 cm', 'HU-016-2', 21.99, NULL, 22),
  (17, '1 kg', 'HU-017-1', 9.99, NULL, 57),
  (18, 'Única', 'HU-018-1', 12.99, NULL, 23),
  (19, '100 g', 'HU-019-1', 11.99, NULL, 30),
  (20, '26 W', 'HU-020-1', 34.99, NULL, 3),
  (21, '250 ml', 'HU-021-1', 9.99, NULL, 44),
  (21, '500 ml', 'HU-021-2', 16.99, NULL, 57),
  (22, '5 kg', 'HU-022-1', 12.99, NULL, 51),
  (22, '10 kg', 'HU-022-2', 22.99, NULL, 23),
  (23, 'M', 'HU-023-1', 11.99, NULL, 58),
  (23, 'L', 'HU-023-2', 14.99, NULL, 30),
  (24, '1 kg', 'HU-024-1', 10.99, NULL, 24);
