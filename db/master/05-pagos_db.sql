-- pagos-service · pagos_db
-- PCI-DSS: NINGUNA columna guarda número de tarjeta, CVV ni fecha de expiración.
-- La tarjeta va del navegador directo a Stripe.js / PayPal; aquí solo queda la referencia.
USE pagos_db;

CREATE TABLE pagos (
    id                 CHAR(36) PRIMARY KEY,                 -- UUID v4
    id_pedido          CHAR(36) NOT NULL,
    id_cliente         INT UNSIGNED NOT NULL,
    monto              DECIMAL(10,2) NOT NULL,
    moneda             CHAR(3) NOT NULL DEFAULT 'USD',
    metodo             ENUM('stripe','paypal') NOT NULL,
    payment_intent_id  VARCHAR(255) NOT NULL,                -- PaymentIntent de Stripe u Order ID de PayPal
    stripe_status      VARCHAR(40) NOT NULL,                 -- estado según la pasarela
    estado             ENUM('iniciado','confirmado','fallido') NOT NULL DEFAULT 'iniciado',
    fecha_pago         DATETIME NULL,                        -- cuando la pasarela confirmó
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pagos_referencia (metodo, payment_intent_id),
    KEY ix_pagos_pedido (id_pedido)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A08: cada webhook se procesa una sola vez (idempotencia) y queda constancia de la verificación de firma.
CREATE TABLE webhook_eventos (
    event_id           VARCHAR(255) PRIMARY KEY,
    proveedor          ENUM('stripe','paypal') NOT NULL,
    tipo               VARCHAR(80) NOT NULL,
    payment_intent_id  VARCHAR(255) NULL,
    recibido_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resultado          VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
