-- ============================================================================
-- 015 — SEGURIDAD, segunda vuelta (auditoría):
--   P0: la 014 recorrió pg_tables, que NO incluye vistas → v_balanza seguía
--       legible por anon vía PostgREST. Se revocan TODAS las vistas, se les
--       activa security_invoker (corren con los privilegios de quien consulta,
--       no del dueño) y se cierra la herencia de USAGE vía PUBLIC en el esquema.
--   P1: inmutabilidad TOTAL por comparación jsonb en facturas y compras
--       (los triggers de 004/007 comparaban solo algunos campos).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- P0 — Vistas: revocar y security_invoker
-- ---------------------------------------------------------------------------
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v.viewname);
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v.viewname);
  END LOOP;
END $$;

-- El esquema public otorgaba USAGE a todos vía PUBLIC (herencia) — se cierra
-- de raíz. El backend es dueño de los objetos: no le afecta.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- P1 — Facturas: emitida/anulada = inmutable TOTAL (solo emitida→anulada,
--       sin tocar ningún otro campo). Borrador sigue libre.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION proteger_factura() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado <> 'borrador' THEN
      RAISE EXCEPTION 'La factura % no se borra: las emitidas se anulan (DGI exige consecutivo completo)',
        COALESCE(OLD.numero_completo, OLD.id::text);
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.estado = 'borrador' THEN
    RETURN NEW;
  END IF;
  IF OLD.estado = 'emitida' AND NEW.estado = 'anulada'
     AND (to_jsonb(NEW) - 'estado' - 'actualizado_por' - 'actualizado_en')
       = (to_jsonb(OLD) - 'estado' - 'actualizado_por' - 'actualizado_en') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'La factura % está %: es inmutable (solo se permite emitida → anulada)',
    COALESCE(OLD.numero_completo, OLD.id::text), OLD.estado;
END $$;

-- ---------------------------------------------------------------------------
-- P1 — Compras: registrada/anulada = inmutable TOTAL (solo registrada→anulada)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION proteger_compra() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado <> 'borrador' THEN
      RAISE EXCEPTION 'La compra % no se borra: las registradas se anulan', OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.estado = 'borrador' THEN
    RETURN NEW;
  END IF;
  IF OLD.estado = 'registrada' AND NEW.estado = 'anulada'
     AND (to_jsonb(NEW) - 'estado' - 'actualizado_por' - 'actualizado_en')
       = (to_jsonb(OLD) - 'estado' - 'actualizado_por' - 'actualizado_en') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'La compra % está %: es inmutable (solo se permite registrada → anulada)',
    OLD.id, OLD.estado;
END $$;
