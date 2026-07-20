-- ============================================================================
-- 014 — SEGURIDAD (auditoría P0/P1):
--   1. Cerrar el acceso directo vía PostgREST: RLS habilitado en TODAS las
--      tablas + REVOKE total a anon/authenticated (presente y futuro).
--      El backend conecta como dueño de las tablas → no le afecta RLS.
--   2. Inmutabilidad a nivel BD para los documentos que no la tenían:
--      recibos, notas de crédito, movimientos de banco y traslados — solo
--      transición a anulado (y conciliado en bancos); nada se borra.
--      Sus líneas/aplicaciones solo se insertan EN LA MISMA transacción
--      que crea el documento (creado_en = now() de la transacción).
--   3. facturas.bodega: la bodega de la venta queda EXPLÍCITA en el documento.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. RLS + REVOKE (deny-by-default: sin políticas, nadie externo entra)
-- ---------------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;

-- Que las tablas futuras nazcan cerradas
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2a. Documentos emitidos: solo pueden pasar a anulado (bancos además puede
--     alternar conciliado). Nada se borra. Comparación por jsonb: cualquier
--     otro campo tocado = rechazo.
-- ---------------------------------------------------------------------------
CREATE FUNCTION proteger_documento_emitido() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_estados_vivos text[] := ARRAY['emitido', 'emitida', 'realizado'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los registros de % no se borran: se anulan', TG_TABLE_NAME;
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (OLD.estado = ANY(v_estados_vivos)) THEN
    RAISE EXCEPTION 'El documento en % ya está anulado: no admite cambios', TG_TABLE_NAME;
  END IF;
  IF (to_jsonb(NEW) - 'estado' - 'actualizado_por' - 'actualizado_en' - 'conciliado' - 'conciliado_en')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'estado' - 'actualizado_por' - 'actualizado_en' - 'conciliado' - 'conciliado_en') THEN
    RAISE EXCEPTION 'El documento en % es inmutable: solo puede anularse (o conciliarse)', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_proteger_recibo BEFORE UPDATE OR DELETE ON recibos
  FOR EACH ROW EXECUTE FUNCTION proteger_documento_emitido();
CREATE TRIGGER trg_proteger_nota_credito BEFORE UPDATE OR DELETE ON notas_credito
  FOR EACH ROW EXECUTE FUNCTION proteger_documento_emitido();
CREATE TRIGGER trg_proteger_mov_banco BEFORE UPDATE OR DELETE ON movimientos_banco
  FOR EACH ROW EXECUTE FUNCTION proteger_documento_emitido();
CREATE TRIGGER trg_proteger_traslado BEFORE UPDATE OR DELETE ON traslados
  FOR EACH ROW EXECUTE FUNCTION proteger_documento_emitido();

-- ---------------------------------------------------------------------------
-- 2b. Líneas/aplicaciones: inmutables, y solo se insertan en la MISMA
--     transacción que crea el documento padre (creado_en = now()).
--     Args: (tabla_padre, columna_fk)
-- ---------------------------------------------------------------------------
CREATE FUNCTION proteger_linea_documento() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_padre_id bigint;
  v_creado timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Las líneas de % son inmutables: el documento se anula, no se edita', TG_TABLE_NAME;
  END IF;
  v_padre_id := (to_jsonb(NEW) ->> TG_ARGV[1])::bigint;
  EXECUTE format('SELECT creado_en FROM %I WHERE id = $1', TG_ARGV[0]) INTO v_creado USING v_padre_id;
  IF v_creado IS NULL OR v_creado <> now() THEN
    RAISE EXCEPTION 'Las líneas de % solo se insertan al crear su documento', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_proteger_recibo_apl BEFORE INSERT OR UPDATE OR DELETE ON recibo_aplicaciones
  FOR EACH ROW EXECUTE FUNCTION proteger_linea_documento('recibos', 'recibo_id');
CREATE TRIGGER trg_proteger_pago_apl BEFORE INSERT OR UPDATE OR DELETE ON pago_aplicaciones
  FOR EACH ROW EXECUTE FUNCTION proteger_linea_documento('movimientos_banco', 'movimiento_banco_id');
CREATE TRIGGER trg_proteger_nc_lineas BEFORE INSERT OR UPDATE OR DELETE ON nota_credito_lineas
  FOR EACH ROW EXECUTE FUNCTION proteger_linea_documento('notas_credito', 'nota_id');
CREATE TRIGGER trg_proteger_traslado_lineas BEFORE INSERT OR UPDATE OR DELETE ON traslado_lineas
  FOR EACH ROW EXECUTE FUNCTION proteger_linea_documento('traslados', 'traslado_id');

-- ---------------------------------------------------------------------------
-- 3. Bodega explícita en la factura (la resolución implícita queda de respaldo)
-- ---------------------------------------------------------------------------
ALTER TABLE facturas ADD COLUMN bodega text REFERENCES bodegas(codigo);
