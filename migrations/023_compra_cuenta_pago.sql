-- ============================================================================
-- 023 — COMPRA DE CONTADO: de qué caja sale el pago. Antes acreditaba siempre
-- la caja general de config; ahora el documento guarda la cuenta elegida
-- (caja general o la caja de una sucursal). Si se pagó con cheque o
-- transferencia, el flujo correcto sigue siendo compra a crédito + pago en
-- Bancos (para que la conciliación cuadre).
-- ============================================================================

ALTER TABLE compras ADD COLUMN cuenta_pago text REFERENCES cuentas(codigo);
