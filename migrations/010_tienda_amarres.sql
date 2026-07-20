-- ============================================================================
-- 010 — AMARRES POR TIENDA:
--   1. series.numero_desde: en series MANUALES define dónde empieza el
--      talonario de papel (no se graban números por debajo; los huecos se
--      cuentan desde ahí). En series de sistema no aplica.
--   2. sucursales.cuenta_caja: la venta de CONTADO cae en la caja de SU
--      tienda; si la sucursal no tiene cuenta asignada, se usa la caja
--      general (config.cuenta_caja).
--   (La validación vendedor-pertenece-a-la-tienda es lógica de emisión.)
-- ============================================================================

ALTER TABLE series ADD COLUMN numero_desde int NOT NULL DEFAULT 1 CHECK (numero_desde >= 1);

ALTER TABLE sucursales ADD COLUMN cuenta_caja text REFERENCES cuentas(codigo);
