-- ============================================================================
-- 018 — PÓLIZAS DE IMPORTACIÓN (F5): liquidación y nacionalización.
-- El costo REAL puesto en bodega de un producto importado = FOB + su parte
-- prorrateada de los gastos no recuperables (flete, seguro, DAI, ISC, agencia,
-- transporte…). El IVA de importación es acreditable (no es costo).
--   * poliza_gastos: cada componente con su base de prorrateo (valor/peso/
--     unidades) y si es IVA acreditable. Cuenta contrapartida configurable.
--   * Al LIQUIDAR: prorratea, mete cada producto al inventario a su costo
--     puesto en bodega (kardex entrada_poliza, recalcula promedio) y genera
--     el asiento de nacionalización. Anular = contra-asiento + reversa kardex.
--   * Montos SIEMPRE en NIO; moneda/tipo_cambio/fob_origen quedan de referencia.
-- ============================================================================

CREATE TABLE polizas (
  id               bigserial PRIMARY KEY,
  numero           text NOT NULL,                 -- nº de póliza aduanera
  tercero_id       bigint REFERENCES terceros(id), -- proveedor del exterior
  fecha            date NOT NULL,
  bodega           text NOT NULL REFERENCES bodegas(codigo),
  moneda           char(3) NOT NULL DEFAULT 'USD' CHECK (moneda IN ('NIO','USD')),
  tipo_cambio      numeric(12,6) NOT NULL DEFAULT 1 CHECK (tipo_cambio > 0),
  estado           text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','liquidada','anulada')),
  fob              numeric(14,2) NOT NULL DEFAULT 0 CHECK (fob >= 0),   -- FOB total en NIO
  gastos           numeric(14,2) NOT NULL DEFAULT 0 CHECK (gastos >= 0),-- gastos no-IVA en NIO
  iva              numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva >= 0),   -- IVA acreditable en NIO
  total_inventario numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_inventario >= 0),
  notas            text,
  asiento_id       bigint REFERENCES asientos(id),
  liquidada_en     timestamptz,
  creado_por       uuid,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_por  uuid,
  actualizado_en   timestamptz
);
CREATE INDEX polizas_estado  ON polizas (estado);
CREATE INDEX polizas_tercero ON polizas (tercero_id);

CREATE TABLE poliza_lineas (
  id             bigserial PRIMARY KEY,
  poliza_id      bigint NOT NULL REFERENCES polizas(id) ON DELETE CASCADE,
  producto_id    bigint NOT NULL REFERENCES productos(id),
  cantidad       numeric(14,2) NOT NULL CHECK (cantidad > 0),
  fob_unitario   numeric(14,4) NOT NULL CHECK (fob_unitario >= 0),   -- en moneda de la póliza
  peso           numeric(14,4) NOT NULL DEFAULT 0,                   -- peso total de la línea (prorrateo)
  costo_unitario numeric(14,4) NOT NULL DEFAULT 0,                   -- puesto en bodega (NIO) al liquidar
  total          numeric(14,2) NOT NULL DEFAULT 0                    -- costo total puesto en bodega (NIO)
);
CREATE INDEX poliza_lineas_poliza ON poliza_lineas (poliza_id);

CREATE TABLE poliza_gastos (
  id              bigserial PRIMARY KEY,
  poliza_id       bigint NOT NULL REFERENCES polizas(id) ON DELETE CASCADE,
  concepto        text NOT NULL,                 -- Flete, Seguro, DAI, ISC, Agencia, Transporte…
  monto           numeric(14,2) NOT NULL CHECK (monto >= 0),  -- en NIO
  base            text NOT NULL DEFAULT 'valor' CHECK (base IN ('valor','peso','unidades')),
  es_iva          boolean NOT NULL DEFAULT false, -- IVA acreditable (no entra al costo)
  cuenta_contable text NOT NULL REFERENCES cuentas(codigo)  -- contrapartida (crédito)
);
CREATE INDEX poliza_gastos_poliza ON poliza_gastos (poliza_id);

-- Inmutabilidad: liquidada/anulada = solo transición a anulada (jsonb total);
-- borrador libre. Líneas/gastos solo se tocan en borrador.
CREATE FUNCTION proteger_poliza() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado <> 'borrador' THEN
      RAISE EXCEPTION 'La póliza % no se borra: las liquidadas se anulan', OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.estado = 'borrador' THEN RETURN NEW; END IF;
  IF OLD.estado = 'liquidada' AND NEW.estado = 'anulada'
     AND (to_jsonb(NEW) - 'estado' - 'actualizado_por' - 'actualizado_en')
       = (to_jsonb(OLD) - 'estado' - 'actualizado_por' - 'actualizado_en') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'La póliza % está %: es inmutable (solo liquidada → anulada)', OLD.id, OLD.estado;
END $$;

CREATE TRIGGER trg_proteger_poliza BEFORE UPDATE OR DELETE ON polizas
  FOR EACH ROW EXECUTE FUNCTION proteger_poliza();

CREATE FUNCTION proteger_poliza_hija() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM polizas
    WHERE id = COALESCE((to_jsonb(NEW) ->> 'poliza_id')::bigint, (to_jsonb(OLD) ->> 'poliza_id')::bigint);
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;  -- borrado en cascada
  IF v_estado IS DISTINCT FROM 'borrador' THEN
    RAISE EXCEPTION 'Las líneas/gastos de la póliza solo se modifican en borrador';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_proteger_poliza_lineas BEFORE INSERT OR UPDATE OR DELETE ON poliza_lineas
  FOR EACH ROW EXECUTE FUNCTION proteger_poliza_hija();
CREATE TRIGGER trg_proteger_poliza_gastos BEFORE INSERT OR UPDATE OR DELETE ON poliza_gastos
  FOR EACH ROW EXECUTE FUNCTION proteger_poliza_hija();

INSERT INTO permisos (rol, modulo, accion) VALUES
  ('contador',  'polizas', 'ver'),
  ('contador',  'polizas', 'crear'),
  ('contador',  'polizas', 'anular'),
  ('comprador', 'polizas', 'ver'),
  ('comprador', 'polizas', 'crear'),
  ('consulta',  'polizas', 'ver')
ON CONFLICT DO NOTHING;
