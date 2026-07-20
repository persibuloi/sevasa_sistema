-- ============================================================================
-- 006 — CATÁLOGO DE PRODUCTOS (lista de precios para facturar).
-- Alcance deliberado: SIN inventario/kardex todavía (existencias y costo de
-- venta se definen en su propia fase — ver riesgo "inventario" del plan).
-- La línea de factura puede referenciar un producto (autollenado de
-- descripción y precio) o seguir siendo texto libre (servicios, varios).
-- ============================================================================

CREATE TABLE productos (
  id              bigserial PRIMARY KEY,
  codigo          text NOT NULL UNIQUE,
  nombre          text NOT NULL,
  unidad          text NOT NULL DEFAULT 'unidad',   -- unidad, bolsa, galón, libra…
  categoria       text,
  precio_venta    numeric(14,2) NOT NULL DEFAULT 0 CHECK (precio_venta >= 0),
  activo          boolean NOT NULL DEFAULT true,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);

ALTER TABLE factura_lineas ADD COLUMN producto_id bigint REFERENCES productos(id);
