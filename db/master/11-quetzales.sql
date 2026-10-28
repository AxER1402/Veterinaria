-- pagos-service · precios en quetzales.
-- monto y moneda son los del pedido (GTQ). monto_pasarela y moneda_pasarela son lo que cobra la
-- pasarela: Stripe cobra en GTQ y PayPal, que no acepta quetzales, en USD al PAYPAL_TIPO_CAMBIO.
-- Los webhooks y la captura se verifican contra lo que cobra la pasarela.
-- Idempotente: ops/migrar-quetzales.sh lo aplica también a una base ya creada.
USE pagos_db;

ALTER TABLE pagos
    ALTER COLUMN moneda SET DEFAULT 'GTQ',
    ADD COLUMN IF NOT EXISTS monto_pasarela  DECIMAL(10,2) NULL AFTER moneda,
    ADD COLUMN IF NOT EXISTS moneda_pasarela CHAR(3) NULL AFTER monto_pasarela;
