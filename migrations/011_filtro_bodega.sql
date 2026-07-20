-- ============================================================================
-- 011 — PARÁMETRO: al facturar, mostrar solo productos con existencia en la
-- bodega de la tienda (sucursal de la serie elegida). 'si' | 'no'.
-- Editable en Configuración → Parámetros, como toda la config.
-- ============================================================================

INSERT INTO config (clave, valor, descripcion) VALUES
  ('ventas_filtrar_por_bodega', 'si',
   'Al facturar, mostrar solo productos con existencia en la bodega de la tienda (si/no)')
ON CONFLICT DO NOTHING;
