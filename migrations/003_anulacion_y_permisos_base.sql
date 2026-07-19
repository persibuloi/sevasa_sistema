-- ============================================================================
-- 003 — AJUSTE DE ANULACIÓN + PERMISOS BASE
-- 1) proteger_asiento: permitir marcar anulado/anulado_por aunque el período
--    del asiento original esté cerrado. El flag es metadato (no altera montos
--    ni fechas); el contra-asiento que revierte los saldos va en un período
--    ABIERTO, así que la inmutabilidad contable del período cerrado se mantiene.
-- 2) Permisos base de contabilidad para contador y consulta (ajustables luego
--    desde la pantalla de administración).
-- ============================================================================

CREATE OR REPLACE FUNCTION proteger_asiento() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los asientos no se borran: se anulan con contra-asiento (asiento %)', OLD.id;
  END IF;

  -- Excepción: si SOLO cambian anulado/anulado_por, es el marcado de una
  -- anulación → permitido aunque el período esté cerrado.
  IF TG_OP = 'UPDATE'
     AND NEW.fecha       IS NOT DISTINCT FROM OLD.fecha
     AND NEW.ano_mes     IS NOT DISTINCT FROM OLD.ano_mes
     AND NEW.tipo_origen IS NOT DISTINCT FROM OLD.tipo_origen
     AND NEW.origen_id   IS NOT DISTINCT FROM OLD.origen_id
     AND NEW.concepto    IS NOT DISTINCT FROM OLD.concepto
     AND NEW.creado_por  IS NOT DISTINCT FROM OLD.creado_por
     AND NEW.creado_en   IS NOT DISTINCT FROM OLD.creado_en THEN
    RETURN NEW;
  END IF;

  IF NEW.ano_mes <> to_char(NEW.fecha, 'YYYY-MM') THEN
    RAISE EXCEPTION 'Asiento con fecha % no corresponde al período %', NEW.fecha, NEW.ano_mes;
  END IF;
  SELECT estado INTO v_estado FROM periodos WHERE ano_mes = NEW.ano_mes;
  IF v_estado IS DISTINCT FROM 'abierto' THEN
    RAISE EXCEPTION 'El período % no está abierto', NEW.ano_mes;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.ano_mes <> NEW.ano_mes THEN
    SELECT estado INTO v_estado FROM periodos WHERE ano_mes = OLD.ano_mes;
    IF v_estado IS DISTINCT FROM 'abierto' THEN
      RAISE EXCEPTION 'El período % no está abierto', OLD.ano_mes;
    END IF;
  END IF;
  RETURN NEW;
END $$;

INSERT INTO permisos (rol, modulo, accion) VALUES
  ('contador', 'contabilidad', 'ver'),
  ('contador', 'contabilidad', 'crear'),
  ('contador', 'contabilidad', 'editar'),
  ('contador', 'contabilidad', 'anular'),
  ('contador', 'contabilidad', 'cerrar'),
  ('consulta', 'contabilidad', 'ver')
ON CONFLICT DO NOTHING;
