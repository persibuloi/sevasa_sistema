-- ============================================================================
-- 004 — FACTURACIÓN (F2a): config, series, talonarios, facturas y líneas.
-- Reglas del plan §F2:
--   * La factura nace BORRADOR sin número; toma número SOLO al emitir, con
--     row-lock sobre la serie (imposible duplicar bajo concurrencia).
--   * Emitida = inmutable. Anulación conserva el número (contra-asiento).
--   * Config en tablas, no en código (tasa IVA, cuentas de enlace).
-- ============================================================================

-- Configuración editable en pantalla (nada quemado en código).
-- Los valores por defecto corresponden al catálogo de prueba; con el catálogo
-- real se ajustan desde la pantalla de administración.
CREATE TABLE config (
  clave       text PRIMARY KEY,
  valor       text NOT NULL,
  descripcion text
);
INSERT INTO config (clave, valor, descripcion) VALUES
  ('tasa_iva',      '0.15',      'Tasa de IVA vigente (DGI)'),
  ('cuenta_caja',   '1-01-01',   'Cuenta contable de caja (ventas de contado)'),
  ('cuenta_cxc',    '1-01-03',   'Cuenta contable de clientes (ventas al crédito)'),
  ('cuenta_ventas', '4-01',      'Cuenta contable de ingresos por ventas'),
  ('cuenta_iva',    '2-02-01',   'Cuenta contable del IVA por pagar');

-- Series de facturación: una (o más) por tienda; tipo sistema o manual
CREATE TABLE series (
  serie         text PRIMARY KEY,          -- ej. 'A-CEN'
  tienda        text NOT NULL,
  tipo          text NOT NULL DEFAULT 'sistema' CHECK (tipo IN ('sistema','manual')),
  prefijo       text NOT NULL,             -- ej. 'A-CEN-' → A-CEN-000123
  ultimo_numero int  NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0),
  activa        boolean NOT NULL DEFAULT true
);

-- Talonarios de papel preimpresos (facturas manuales de contingencia)
CREATE TABLE talonarios (
  id           bigserial PRIMARY KEY,
  serie_manual text NOT NULL REFERENCES series(serie),
  rango_desde  int NOT NULL CHECK (rango_desde > 0),
  rango_hasta  int NOT NULL,
  estado       text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','agotado','anulado')),
  CHECK (rango_hasta >= rango_desde)
);

CREATE TABLE facturas (
  id              bigserial PRIMARY KEY,
  serie           text NOT NULL REFERENCES series(serie),
  numero          int,                     -- NULL mientras es borrador
  numero_completo text,                    -- 'A-CEN-000123' al emitir
  fecha           date NOT NULL,
  tercero_id      bigint NOT NULL REFERENCES terceros(id),
  tipo_pago       text NOT NULL CHECK (tipo_pago IN ('contado','credito')),
  estado          text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','emitida','anulada')),
  origen          text NOT NULL DEFAULT 'sistema' CHECK (origen IN ('sistema','manual')),
  subtotal        numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  iva             numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva >= 0),
  total           numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  moneda          char(3) NOT NULL DEFAULT 'NIO' CHECK (moneda IN ('NIO','USD')),
  notas           text,
  asiento_id      bigint REFERENCES asientos(id),
  emitida_en      timestamptz,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);
CREATE UNIQUE INDEX facturas_numero_unico ON facturas (serie, numero) WHERE numero IS NOT NULL;
CREATE INDEX facturas_estado  ON facturas (estado);
CREATE INDEX facturas_tercero ON facturas (tercero_id);
CREATE INDEX facturas_fecha   ON facturas (fecha);

CREATE TABLE factura_lineas (
  id              bigserial PRIMARY KEY,
  factura_id      bigint NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  descripcion     text NOT NULL,
  cantidad        numeric(12,2) NOT NULL CHECK (cantidad > 0),
  precio_unitario numeric(14,2) NOT NULL CHECK (precio_unitario >= 0),
  total           numeric(14,2) NOT NULL CHECK (total >= 0)
);
CREATE INDEX factura_lineas_factura ON factura_lineas (factura_id);

-- ============================================================================
-- Inmutabilidad: emitida no se toca (solo transición a anulada); borrador
-- sí se puede editar/borrar. Las líneas siguen el estado de su factura.
-- ============================================================================
CREATE FUNCTION proteger_factura() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado <> 'borrador' THEN
      RAISE EXCEPTION 'La factura % no se borra: las emitidas se anulan (DGI exige consecutivo completo)',
        COALESCE(OLD.numero_completo, OLD.id::text);
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.estado = 'borrador' THEN
    RETURN NEW;  -- borrador editable (incluida la emisión misma)
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.estado = 'emitida' THEN
    -- solo se permite pasar a anulada, sin tocar montos ni número
    IF NEW.estado = 'anulada'
       AND NEW.subtotal IS NOT DISTINCT FROM OLD.subtotal
       AND NEW.iva      IS NOT DISTINCT FROM OLD.iva
       AND NEW.total    IS NOT DISTINCT FROM OLD.total
       AND NEW.numero   IS NOT DISTINCT FROM OLD.numero
       AND NEW.serie    IS NOT DISTINCT FROM OLD.serie
       AND NEW.fecha    IS NOT DISTINCT FROM OLD.fecha
       AND NEW.tercero_id IS NOT DISTINCT FROM OLD.tercero_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'La factura % está emitida: es inmutable (solo puede anularse)', OLD.numero_completo;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.estado = 'anulada' THEN
    RAISE EXCEPTION 'La factura % está anulada: no admite cambios', COALESCE(OLD.numero_completo, OLD.id::text);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_proteger_factura
  BEFORE UPDATE OR DELETE ON facturas
  FOR EACH ROW EXECUTE FUNCTION proteger_factura();

CREATE FUNCTION proteger_factura_linea() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM facturas WHERE id = COALESCE(NEW.factura_id, OLD.factura_id);
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);  -- la factura se está borrando en cascada (era borrador)
  END IF;
  IF v_estado IS DISTINCT FROM 'borrador' THEN
    RAISE EXCEPTION 'Las líneas solo se modifican mientras la factura es borrador';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_proteger_factura_linea
  BEFORE INSERT OR UPDATE OR DELETE ON factura_lineas
  FOR EACH ROW EXECUTE FUNCTION proteger_factura_linea();

-- Permisos base del módulo facturación (ajustables por pantalla de admin)
INSERT INTO permisos (rol, modulo, accion) VALUES
  ('contador',   'facturacion', 'ver'),
  ('contador',   'facturacion', 'crear'),
  ('contador',   'facturacion', 'editar'),
  ('contador',   'facturacion', 'anular'),
  ('facturador', 'facturacion', 'ver'),
  ('facturador', 'facturacion', 'crear'),
  ('facturador', 'facturacion', 'editar'),
  ('cajero',     'facturacion', 'ver'),
  ('consulta',   'facturacion', 'ver')
ON CONFLICT DO NOTHING;
