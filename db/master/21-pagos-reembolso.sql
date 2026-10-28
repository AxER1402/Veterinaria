-- pagos-service · reembolso hecho desde el panel por la API de la pasarela (Stripe Refunds o PayPal
-- captures/refund). Solo se guarda la referencia del reembolso, nunca datos de tarjeta (PCI-DSS).
-- Idempotente: ops/migrar-v2.sh lo aplica también a una base ya creada.
USE pagos_db;
ALTER TABLE pagos
    ADD COLUMN IF NOT EXISTS reembolso_ref VARCHAR(255) NULL AFTER fecha_pago,
    ADD COLUMN IF NOT EXISTS reembolsado_en DATETIME NULL AFTER reembolso_ref;
