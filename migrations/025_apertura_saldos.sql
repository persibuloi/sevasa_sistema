-- ============================================================================
-- 025 — Apertura de saldos iniciales
-- Las facturas/compras "de apertura" son auxiliares del saldo global por
-- tercero (decisión §F1): documentos SIN asiento propio — el asiento único
-- tipo 'apertura' trae la balanza completa del sistema anterior.
-- ============================================================================

-- Origen 'apertura' en facturas (cartera inicial por cliente)
ALTER TABLE facturas DROP CONSTRAINT facturas_origen_check;
ALTER TABLE facturas ADD CONSTRAINT facturas_origen_check
  CHECK (origen IN ('sistema','manual','apertura'));

-- Serie exclusiva de la apertura: numera las facturas iniciales (INI-000001…).
-- Inactiva: jamás aparece para facturar; solo el cargador de apertura la usa.
INSERT INTO series (serie, sucursal, tipo, prefijo, documento, activa)
VALUES ('INI', NULL, 'sistema', 'INI-', 'factura', false)
ON CONFLICT (serie) DO NOTHING;
