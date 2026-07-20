-- ============================================================================
-- 012 — TRASLADOS ENTRE BODEGAS (movimiento físico de inventario).
-- Flujo real: la mercadería se RECIBE en una bodega central y se reparte a
-- las tiendas por traslado. SIN asiento contable (la cuenta de inventario no
-- cambia — solo la ubicación); kardex doble: salida en origen + entrada en
-- destino, al costo promedio vigente. Exige existencia suficiente en origen.
-- ============================================================================

ALTER TABLE movimientos_inventario DROP CONSTRAINT movimientos_inventario_tipo_check;
ALTER TABLE movimientos_inventario ADD CONSTRAINT movimientos_inventario_tipo_check
  CHECK (tipo IN ('entrada_compra','entrada_poliza','salida_venta',
                  'ajuste_entrada','ajuste_salida','anulacion','devolucion',
                  'traslado_salida','traslado_entrada'));

CREATE TABLE traslados (
  id              bigserial PRIMARY KEY,
  fecha           date NOT NULL,
  bodega_origen   text NOT NULL REFERENCES bodegas(codigo),
  bodega_destino  text NOT NULL REFERENCES bodegas(codigo),
  CHECK (bodega_origen <> bodega_destino),
  estado          text NOT NULL DEFAULT 'realizado' CHECK (estado IN ('realizado','anulado')),
  notas           text,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);
CREATE INDEX traslados_origen  ON traslados (bodega_origen);
CREATE INDEX traslados_destino ON traslados (bodega_destino);

CREATE TABLE traslado_lineas (
  id             bigserial PRIMARY KEY,
  traslado_id    bigint NOT NULL REFERENCES traslados(id),
  producto_id    bigint NOT NULL REFERENCES productos(id),
  cantidad       numeric(14,2) NOT NULL CHECK (cantidad > 0),
  costo_unitario numeric(14,4) NOT NULL DEFAULT 0   -- promedio al momento (valorización)
);
CREATE INDEX traslado_lineas_traslado ON traslado_lineas (traslado_id);

-- Permisos del módulo inventario
INSERT INTO permisos (rol, modulo, accion) VALUES
  ('contador',  'inventario', 'ver'),
  ('contador',  'inventario', 'crear'),
  ('contador',  'inventario', 'anular'),
  ('comprador', 'inventario', 'ver'),
  ('comprador', 'inventario', 'crear'),
  ('facturador','inventario', 'ver'),
  ('consulta',  'inventario', 'ver')
ON CONFLICT DO NOTHING;
