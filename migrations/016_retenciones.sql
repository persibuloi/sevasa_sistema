-- ============================================================================
-- 016 — RETENCIONES (F4).
-- SEVASA es agente RETENEDOR (retiene a sus proveedores = retención EFECTUADA,
-- un pasivo con la DGI) pero EXENTO de que le retengan por ser gran
-- contribuyente (retención RECIBIDA = no aplica hoy, pero queda modelada).
--   * Tipos configurables: tasa, base (subtotal/iva/total), cuenta y si
--     aplica a compra (efectuada) o venta (recibida).
--   * Compra: al registrar, cada retención acredita su cuenta y baja la CxP
--     por el neto. El pago (F3) ya paga el neto sin tocar nada.
--   * Recibo: soporta retención sufrida (activo, anticipo IR) — disponible,
--     no obligatorio.
--   * compra_retenciones / recibo_retenciones: INSERT-only (nada se edita ni
--     borra; el documento se anula y su asiento se revierte entero).
-- ============================================================================

CREATE TABLE retencion_tipos (
  codigo          text PRIMARY KEY,
  nombre          text NOT NULL,
  tasa            numeric(6,4) NOT NULL CHECK (tasa > 0 AND tasa < 1),   -- 0.02 = 2%
  base            text NOT NULL DEFAULT 'subtotal' CHECK (base IN ('subtotal','iva','total')),
  cuenta_contable text NOT NULL REFERENCES cuentas(codigo),
  aplica          text NOT NULL CHECK (aplica IN ('compra','venta')),    -- efectuada / recibida
  activo          boolean NOT NULL DEFAULT true,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);

-- Selección de retenciones del borrador de compra (editable mientras borrador)
ALTER TABLE compras ADD COLUMN retenciones_codigos text[] NOT NULL DEFAULT '{}';

-- Registro definitivo de retenciones posteadas (INSERT-only)
CREATE TABLE compra_retenciones (
  id          bigserial PRIMARY KEY,
  compra_id   bigint NOT NULL REFERENCES compras(id),
  tipo_codigo text NOT NULL REFERENCES retencion_tipos(codigo),
  base        numeric(14,2) NOT NULL CHECK (base >= 0),
  monto       numeric(14,2) NOT NULL CHECK (monto >= 0)
);
CREATE INDEX compra_retenciones_compra ON compra_retenciones (compra_id);

CREATE TABLE recibo_retenciones (
  id          bigserial PRIMARY KEY,
  recibo_id   bigint NOT NULL REFERENCES recibos(id),
  tipo_codigo text NOT NULL REFERENCES retencion_tipos(codigo),
  base        numeric(14,2) NOT NULL CHECK (base >= 0),
  monto       numeric(14,2) NOT NULL CHECK (monto >= 0)
);
CREATE INDEX recibo_retenciones_recibo ON recibo_retenciones (recibo_id);

-- Solo se insertan (al registrar/emitir su documento); nunca se editan ni borran
CREATE FUNCTION solo_insertar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los registros de % son inmutables: el documento se anula, no se edita', TG_TABLE_NAME;
END $$;

CREATE TRIGGER trg_compra_retenciones_ro BEFORE UPDATE OR DELETE ON compra_retenciones
  FOR EACH ROW EXECUTE FUNCTION solo_insertar();
CREATE TRIGGER trg_recibo_retenciones_ro BEFORE UPDATE OR DELETE ON recibo_retenciones
  FOR EACH ROW EXECUTE FUNCTION solo_insertar();

-- El nuevo tipo de origen del asiento de pago de retenciones a la DGI (futuro)
-- ya está cubierto por 'banco'/'manual'. Permisos: configurar tipos = admin.
-- Ver retenciones (reporte) = módulo contabilidad; aplicarlas usa compras/cxc.
