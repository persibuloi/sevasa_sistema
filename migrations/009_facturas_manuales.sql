-- ============================================================================
-- 009 — FACTURAS MANUALES (contingencia sin internet, plan §F2).
-- Decisión del usuario: SIN gestión de talonarios — se definen SERIES de tipo
-- 'manual' por sucursal y las facturas de papel se GRABAN en el sistema
-- digitando el número del papel. Contablemente idénticas (mismo asiento,
-- mismo inventario), marcadas origen='manual'.
--   * Una factura de papel DAÑADA se graba como ANULADA (sin cliente ni
--     montos) para que el consecutivo quede completo ante la DGI → por eso
--     tercero_id pasa a ser opcional SOLO en ese caso.
--   * Huecos: el sistema AVISA (control de serie) pero no bloquea.
-- ============================================================================

ALTER TABLE facturas ALTER COLUMN tercero_id DROP NOT NULL;
ALTER TABLE facturas ADD CONSTRAINT factura_tercero_obligatorio
  CHECK (tercero_id IS NOT NULL OR (estado = 'anulada' AND origen = 'manual'));

-- Series manuales de prueba, solo si existen las sucursales de prueba
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sucursales WHERE codigo = 'CEN') THEN
    INSERT INTO series (serie, sucursal, tipo, prefijo, documento) VALUES
      ('M-CEN', 'CEN', 'manual', 'M-CEN-', 'factura'),
      ('M-SUR', 'SUR', 'manual', 'M-SUR-', 'factura')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
