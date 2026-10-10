-- pedidos-service · pedidos_db
USE pedidos_db;

-- Datos de contacto del cliente. id_cliente = auth_db.usuarios.id (viene del JWT, nunca del cuerpo).
CREATE TABLE clientes (
    id_cliente  INT UNSIGNED PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL,
    email       VARCHAR(120) NOT NULL,
    telefono    VARCHAR(20)  NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE direcciones_entrega (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_cliente  INT UNSIGNED NOT NULL,
    direccion   VARCHAR(200) NOT NULL,
    ciudad      VARCHAR(80)  NOT NULL,
    notas       VARCHAR(200) NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_direcciones_cliente FOREIGN KEY (id_cliente) REFERENCES clientes (id_cliente),
    UNIQUE KEY uq_direccion (id_cliente, direccion, ciudad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Los descuentos se calculan en el servidor (T de STRIDE): el cliente solo envía el código.
CREATE TABLE cupones (
    codigo       VARCHAR(30) PRIMARY KEY,
    descripcion  VARCHAR(120) NOT NULL,
    porcentaje   TINYINT UNSIGNED NOT NULL,
    marca        VARCHAR(60) NULL,           -- NULL = aplica a todo el carrito
    activo       TINYINT(1) NOT NULL DEFAULT 1,
    vence        DATETIME NULL,
    CONSTRAINT ck_cupones_porcentaje CHECK (porcentaje BETWEEN 1 AND 90)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- I de STRIDE: el id es un UUID v4, no un entero secuencial que se pueda adivinar.
CREATE TABLE pedidos (
    id              CHAR(36) PRIMARY KEY,
    id_cliente      INT UNSIGNED NOT NULL,
    estado          ENUM('pendiente_pago','pagado','preparando','enviado','entregado','cancelado') NOT NULL DEFAULT 'pendiente_pago',
    metodo_entrega  ENUM('domicilio','retiro') NOT NULL,
    sede            VARCHAR(120) NULL,
    direccion_id    INT UNSIGNED NULL,
    subtotal        DECIMAL(10,2) NOT NULL,
    descuento       DECIMAL(10,2) NOT NULL DEFAULT 0,
    envio           DECIMAL(10,2) NOT NULL DEFAULT 0,
    total           DECIMAL(10,2) NOT NULL,
    cupon           VARCHAR(30) NULL,
    fecha           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_pedidos_cliente   FOREIGN KEY (id_cliente)   REFERENCES clientes (id_cliente),
    CONSTRAINT fk_pedidos_direccion FOREIGN KEY (direccion_id) REFERENCES direcciones_entrega (id),
    CONSTRAINT ck_pedidos_total CHECK (total >= 0 AND total = subtotal - descuento + envio),
    KEY ix_pedidos_cliente (id_cliente, fecha),
    KEY ix_pedidos_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Precio congelado al momento de la compra (copiado de catalogo-service, no del cliente).
CREATE TABLE detalle_pedidos (
    id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pedido_id          CHAR(36) NOT NULL,
    producto_id        INT UNSIGNED NOT NULL,
    variante_id        INT UNSIGNED NOT NULL,
    producto_nombre    VARCHAR(150) NOT NULL,
    variante_etiqueta  VARCHAR(40)  NOT NULL,
    imagen_url         VARCHAR(500) NULL,
    precio_unitario    DECIMAL(10,2) NOT NULL,
    cantidad           SMALLINT UNSIGNED NOT NULL,
    subtotal           DECIMAL(10,2) NOT NULL,
    CONSTRAINT fk_detalle_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos (id),
    CONSTRAINT ck_detalle CHECK (cantidad BETWEEN 1 AND 99 AND subtotal = precio_unitario * cantidad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE historial_estados (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pedido_id        CHAR(36) NOT NULL,
    estado_anterior  VARCHAR(20) NULL,
    estado_nuevo     VARCHAR(20) NOT NULL,
    cambiado_por     INT UNSIGNED NULL,      -- NULL = sistema (p. ej. pagos-service)
    comentario       VARCHAR(200) NULL,
    fecha            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_historial_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos (id),
    KEY ix_historial_pedido (pedido_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO cupones (codigo, descripcion, porcentaje, marca) VALUES
  ('HUELLITAS10', '10% en toda la compra', 10, NULL),
  ('FLASH50',     '50% en productos NutriHuella', 50, 'NutriHuella');
