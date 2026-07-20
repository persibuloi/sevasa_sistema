-- ============================================================================
-- 008 — CxC: RECIBOS DE COBRO, NOTAS DE CRÉDITO Y CARTERA (F2).
--   * Series por tipo de documento (factura / recibo / nota_credito) —
--     mismo consecutivo con row-lock para todos (plan §F2 punto 6).
--   * Recibo: cobra facturas de crédito (aplicaciones) o a cuenta;
--     asiento Caja vs CxC. Anulación por contra-asiento, número se conserva.
--   * Nota de crédito: sobre una factura emitida. Devolución (reingresa
--     inventario al costo con que salió) o rebaja. Asiento completo.
-- ============================================================================

ALTER TABLE series ADD COLUMN documento text NOT NULL DEFAULT 'factura'
  CHECK (documento IN ('factura', 'recibo', 'nota_credito'));

-- Series por defecto para recibos y NC (configurables en Parámetros)
INSERT INTO series (serie, tipo, prefijo, documento) VALUES
  ('REC', 'sistema', 'REC-', 'recibo'),
  ('NC',  'sistema', 'NC-',  'nota_credito')
ON CONFLICT DO NOTHING;

INSERT INTO config (clave, valor, descripcion) VALUES
  ('serie_recibos',       'REC', 'Serie de los recibos de cobro'),
  ('serie_notas_credito', 'NC',  'Serie de las notas de crédito')
ON CONFLICT DO NOTHING;

-- El kardex aprende el tipo devolución (reingreso por nota de crédito)
ALTER TABLE movimientos_inventario DROP CONSTRAINT movimientos_inventario_tipo_check;
ALTER TABLE movimientos_inventario ADD CONSTRAINT movimientos_inventario_tipo_check
  CHECK (tipo IN ('entrada_compra','entrada_poliza','salida_venta',
                  'ajuste_entrada','ajuste_salida','anulacion','devolucion'));

CREATE TABLE recibos (
  id              bigserial PRIMARY KEY,
  serie           text NOT NULL REFERENCES series(serie),
  numero          int NOT NULL,
  numero_completo text NOT NULL UNIQUE,
  fecha           date NOT NULL,
  tercero_id      bigint NOT NULL REFERENCES terceros(id),
  forma_pago      text NOT NULL CHECK (forma_pago IN ('efectivo','transferencia','cheque','tarjeta')),
  referencia      text,                    -- nº de transferencia / cheque recibido
  total           numeric(14,2) NOT NULL CHECK (total > 0),
  estado          text NOT NULL DEFAULT 'emitido' CHECK (estado IN ('emitido','anulado')),
  asiento_id      bigint REFERENCES asientos(id),
  notas           text,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);
CREATE INDEX recibos_tercero ON recibos (tercero_id);

CREATE TABLE recibo_aplicaciones (
  id         bigserial PRIMARY KEY,
  recibo_id  bigint NOT NULL REFERENCES recibos(id),
  factura_id bigint REFERENCES facturas(id),   -- NULL = cobro a cuenta
  monto      numeric(14,2) NOT NULL CHECK (monto > 0)
);
CREATE INDEX recibo_aplicaciones_factura ON recibo_aplicaciones (factura_id) WHERE factura_id IS NOT NULL;
CREATE INDEX recibo_aplicaciones_recibo  ON recibo_aplicaciones (recibo_id);

CREATE TABLE notas_credito (
  id              bigserial PRIMARY KEY,
  serie           text NOT NULL REFERENCES series(serie),
  numero          int NOT NULL,
  numero_completo text NOT NULL UNIQUE,
  fecha           date NOT NULL,
  factura_id      bigint NOT NULL REFERENCES facturas(id),
  tercero_id      bigint NOT NULL REFERENCES terceros(id),
  tipo            text NOT NULL CHECK (tipo IN ('devolucion','rebaja')),
  motivo          text NOT NULL,
  subtotal        numeric(14,2) NOT NULL CHECK (subtotal > 0),
  iva             numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva >= 0),
  total           numeric(14,2) NOT NULL CHECK (total > 0),
  costo           numeric(14,2) NOT NULL DEFAULT 0,  -- costo reingresado (devolución)
  estado          text NOT NULL DEFAULT 'emitida' CHECK (estado IN ('emitida','anulada')),
  asiento_id      bigint REFERENCES asientos(id),
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);
CREATE INDEX notas_credito_factura ON notas_credito (factura_id);

CREATE TABLE nota_credito_lineas (
  id               bigserial PRIMARY KEY,
  nota_id          bigint NOT NULL REFERENCES notas_credito(id),
  factura_linea_id bigint REFERENCES factura_lineas(id),
  producto_id      bigint REFERENCES productos(id),
  cantidad         numeric(14,2) NOT NULL CHECK (cantidad > 0),
  precio_unitario  numeric(14,2) NOT NULL CHECK (precio_unitario >= 0),
  total            numeric(14,2) NOT NULL CHECK (total >= 0)
);
CREATE INDEX nc_lineas_nota ON nota_credito_lineas (nota_id);

-- Permisos del módulo CxC (cobranza)
INSERT INTO permisos (rol, modulo, accion) VALUES
  ('contador',   'cxc', 'ver'),
  ('contador',   'cxc', 'crear'),
  ('contador',   'cxc', 'anular'),
  ('cajero',     'cxc', 'ver'),
  ('cajero',     'cxc', 'crear'),
  ('facturador', 'cxc', 'ver'),
  ('consulta',   'cxc', 'ver')
ON CONFLICT DO NOTHING;
