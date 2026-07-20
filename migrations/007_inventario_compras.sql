-- ============================================================================
-- 007 — INVENTARIO PERPETUO + COMPRAS LOCALES (decisión: ciclo completo).
--   OC (control, sin contabilidad) → compra local → asiento
--   (Inventario + IVA acreditable vs CxP/Caja) + kardex + costo promedio.
--   La factura de venta descargará inventario y generará costo de venta
--   en el MISMO asiento de la venta (anulación revierte todo junto).
-- ============================================================================

ALTER TABLE productos ADD COLUMN costo_promedio numeric(14,4) NOT NULL DEFAULT 0;

CREATE TABLE existencias (
  producto_id bigint NOT NULL REFERENCES productos(id),
  bodega      text   NOT NULL REFERENCES bodegas(codigo),
  cantidad    numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (producto_id, bodega)
);

-- Kardex: fuente de verdad de todo movimiento físico
CREATE TABLE movimientos_inventario (
  id             bigserial PRIMARY KEY,
  fecha          date NOT NULL,
  producto_id    bigint NOT NULL REFERENCES productos(id),
  bodega         text   NOT NULL REFERENCES bodegas(codigo),
  tipo           text NOT NULL CHECK (tipo IN (
                   'entrada_compra','entrada_poliza','salida_venta',
                   'ajuste_entrada','ajuste_salida','anulacion')),
  origen_tipo    text,             -- 'compra' | 'factura' | 'poliza' | 'ajuste'
  origen_id      bigint,
  cantidad       numeric(14,2) NOT NULL CHECK (cantidad <> 0),  -- + entrada / - salida
  costo_unitario numeric(14,4) NOT NULL DEFAULT 0,
  creado_por     uuid,
  creado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kardex_producto ON movimientos_inventario (producto_id, fecha);
CREATE INDEX kardex_origen   ON movimientos_inventario (origen_tipo, origen_id);

-- Órdenes de compra: documento de control, SIN efecto contable
CREATE TABLE ordenes_compra (
  id              bigserial PRIMARY KEY,
  tercero_id      bigint NOT NULL REFERENCES terceros(id),
  fecha           date NOT NULL,
  bodega          text REFERENCES bodegas(codigo),
  estado          text NOT NULL DEFAULT 'borrador'
                  CHECK (estado IN ('borrador','aprobada','recibida','anulada')),
  notas           text,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);

CREATE TABLE orden_compra_lineas (
  id             bigserial PRIMARY KEY,
  orden_id       bigint NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  producto_id    bigint REFERENCES productos(id),
  descripcion    text NOT NULL,
  cantidad       numeric(14,2) NOT NULL CHECK (cantidad > 0),
  costo_unitario numeric(14,4) NOT NULL DEFAULT 0,
  total          numeric(14,2) NOT NULL DEFAULT 0
);

-- Compras locales (factura del proveedor)
CREATE TABLE compras (
  id               bigserial PRIMARY KEY,
  orden_compra_id  bigint REFERENCES ordenes_compra(id),
  tercero_id       bigint NOT NULL REFERENCES terceros(id),
  numero_documento text NOT NULL,          -- nº de factura del proveedor
  fecha            date NOT NULL,
  tipo_pago        text NOT NULL CHECK (tipo_pago IN ('contado','credito')),
  bodega           text NOT NULL REFERENCES bodegas(codigo),
  estado           text NOT NULL DEFAULT 'borrador'
                   CHECK (estado IN ('borrador','registrada','anulada')),
  subtotal         numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  iva              numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva >= 0),
  total            numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notas            text,
  asiento_id       bigint REFERENCES asientos(id),
  registrada_en    timestamptz,
  creado_por       uuid,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_por  uuid,
  actualizado_en   timestamptz
);
CREATE INDEX compras_tercero ON compras (tercero_id);
CREATE INDEX compras_estado  ON compras (estado);

CREATE TABLE compra_lineas (
  id             bigserial PRIMARY KEY,
  compra_id      bigint NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  producto_id    bigint NOT NULL REFERENCES productos(id),
  cantidad       numeric(14,2) NOT NULL CHECK (cantidad > 0),
  costo_unitario numeric(14,4) NOT NULL CHECK (costo_unitario >= 0),
  total          numeric(14,2) NOT NULL CHECK (total >= 0)
);
CREATE INDEX compra_lineas_compra ON compra_lineas (compra_id);

-- Inmutabilidad (mismo patrón que facturas)
CREATE FUNCTION proteger_compra() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado <> 'borrador' THEN
      RAISE EXCEPTION 'La compra % no se borra: las registradas se anulan', OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.estado = 'borrador' THEN RETURN NEW; END IF;
  IF OLD.estado = 'registrada' THEN
    IF NEW.estado = 'anulada'
       AND NEW.subtotal IS NOT DISTINCT FROM OLD.subtotal
       AND NEW.iva      IS NOT DISTINCT FROM OLD.iva
       AND NEW.total    IS NOT DISTINCT FROM OLD.total
       AND NEW.fecha    IS NOT DISTINCT FROM OLD.fecha
       AND NEW.tercero_id IS NOT DISTINCT FROM OLD.tercero_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'La compra % está registrada: es inmutable (solo puede anularse)', OLD.id;
  END IF;
  RAISE EXCEPTION 'La compra % está anulada: no admite cambios', OLD.id;
END $$;

CREATE TRIGGER trg_proteger_compra
  BEFORE UPDATE OR DELETE ON compras
  FOR EACH ROW EXECUTE FUNCTION proteger_compra();

CREATE FUNCTION proteger_compra_linea() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM compras WHERE id = COALESCE(NEW.compra_id, OLD.compra_id);
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;
  IF v_estado IS DISTINCT FROM 'borrador' THEN
    RAISE EXCEPTION 'Las líneas solo se modifican mientras la compra es borrador';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_proteger_compra_linea
  BEFORE INSERT OR UPDATE OR DELETE ON compra_lineas
  FOR EACH ROW EXECUTE FUNCTION proteger_compra_linea();

-- Cuentas de enlace nuevas (valores por defecto del catálogo de prueba;
-- ajustables en Configuración → Parámetros)
INSERT INTO config (clave, valor, descripcion) VALUES
  ('cuenta_inventario',      '1-01-04', 'Cuenta contable de inventario'),
  ('cuenta_iva_acreditable', '1-01-05', 'IVA acreditable (crédito fiscal en compras)'),
  ('cuenta_cxp',             '2-01',    'Cuenta contable de proveedores (CxP)'),
  ('cuenta_costo_ventas',    '5-01',    'Cuenta contable del costo de ventas')
ON CONFLICT DO NOTHING;

-- Permisos base del módulo compras
INSERT INTO permisos (rol, modulo, accion) VALUES
  ('contador',  'compras', 'ver'),
  ('contador',  'compras', 'crear'),
  ('contador',  'compras', 'editar'),
  ('contador',  'compras', 'anular'),
  ('comprador', 'compras', 'ver'),
  ('comprador', 'compras', 'crear'),
  ('comprador', 'compras', 'editar'),
  ('consulta',  'compras', 'ver')
ON CONFLICT DO NOTHING;
