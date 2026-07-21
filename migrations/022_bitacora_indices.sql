-- ============================================================================
-- 022 — ÍNDICES DE BITÁCORA para volumen (≈300 mil filas/año con 10 mil
-- facturas/mes): la pantalla filtra por fecha y por acción, que no tenían
-- índice. La bitácora NUNCA se borra (auditoría contable); si en muchos años
-- pesara, se archiva por año — jamás se depura en caliente.
-- ============================================================================

CREATE INDEX bitacora_fecha  ON bitacora (en DESC);
CREATE INDEX bitacora_accion ON bitacora (accion, en DESC);
