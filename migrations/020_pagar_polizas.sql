-- ============================================================================
-- 020 — PÓLIZAS PAGABLES: la póliza liquidada acredita la CxP de cada
-- proveedor (asiento correcto desde 018/019), pero la pantalla de pago solo
-- listaba compras. Ahora un pago bancario puede aplicarse a una PÓLIZA
-- (por proveedor) igual que a una compra.
-- ============================================================================

ALTER TABLE pago_aplicaciones ALTER COLUMN compra_id DROP NOT NULL;
ALTER TABLE pago_aplicaciones ADD COLUMN poliza_id bigint REFERENCES polizas(id);
ALTER TABLE pago_aplicaciones ADD CONSTRAINT pago_aplicacion_destino
  CHECK ((compra_id IS NULL) <> (poliza_id IS NULL));  -- exactamente uno
CREATE INDEX pago_aplicaciones_poliza ON pago_aplicaciones (poliza_id) WHERE poliza_id IS NOT NULL;
