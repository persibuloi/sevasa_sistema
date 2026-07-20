-- ============================================================================
-- 017 — PARÁMETRO: bloquear la venta cuando no hay existencia suficiente en la
-- bodega. 'si' (default, DECIDIDO por el usuario) rechaza la emisión de una
-- factura cuya cantidad supere la existencia; 'no' permite el negativo (rojo).
-- Editable en Configuración → Parámetros. La validación real vive en el motor
-- de inventario (salidaInventario), transaccional y con lock del producto.
-- ============================================================================

INSERT INTO config (clave, valor, descripcion) VALUES
  ('ventas_bloquear_sin_existencia', 'si',
   'Bloquear la factura si la cantidad supera la existencia de la bodega (si/no)')
ON CONFLICT DO NOTHING;
