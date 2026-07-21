-- ============================================================================
-- 021 — F6: ESTADOS FINANCIEROS. La cuenta donde el cierre del ejercicio
-- deposita la utilidad (o pérdida) es configurable, como toda cuenta de enlace.
-- ============================================================================

INSERT INTO config (clave, valor, descripcion) VALUES
  ('cuenta_resultados_acumulados', '3-02',
   'Cuenta de capital donde el cierre del ejercicio salda la utilidad/pérdida')
ON CONFLICT DO NOTHING;
