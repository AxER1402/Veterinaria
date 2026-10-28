-- pedidos-service · «listo para retirar» y reembolsos a la vista.
-- Idempotente: ops/migrar-v2.sh lo aplica también a una base ya creada.
USE pedidos_db;

ALTER TABLE pedidos
    MODIFY COLUMN estado ENUM('pendiente_pago','pagado','preparando','listo_retiro','enviado','entregado','cancelado') NOT NULL DEFAULT 'pendiente_pago',
    -- Un pedido cobrado que se cancela (o un pago que llega después de cancelar) queda «pendiente»
    -- hasta que alguien registra el reembolso hecho en la pasarela.
    ADD COLUMN IF NOT EXISTS reembolso      ENUM('pendiente','hecho') NULL AFTER cupon,
    ADD COLUMN IF NOT EXISTS reembolso_ref  VARCHAR(100) NULL AFTER reembolso;
CREATE INDEX IF NOT EXISTS ix_pedidos_reembolso ON pedidos (reembolso);
