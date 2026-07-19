-- ============================================================================
-- 005 — CONFIGURACIÓN OPERATIVA: sucursales, bodegas y vendedores.
-- Patrón del plan (F0): el panel de administración crece por fase; todo
-- configurable en tablas, nada quemado en código.
--   * series ahora cuelga de una sucursal (una o más series por sucursal)
--   * facturas puede llevar vendedor (comisiones/reportes futuros)
--   * bodegas queda lista para inventario (fase futura) y pólizas (F5)
-- ============================================================================

CREATE TABLE sucursales (
  codigo          text PRIMARY KEY,          -- ej. 'CEN', 'SUR', 'ALT'
  nombre          text NOT NULL,
  direccion       text,
  telefono        text,
  activa          boolean NOT NULL DEFAULT true,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);

CREATE TABLE bodegas (
  codigo          text PRIMARY KEY,          -- ej. 'BOD-CEN'
  nombre          text NOT NULL,
  sucursal        text NOT NULL REFERENCES sucursales(codigo),
  activa          boolean NOT NULL DEFAULT true,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);

CREATE TABLE vendedores (
  id              bigserial PRIMARY KEY,
  codigo          text UNIQUE,               -- código corto para reportes (opcional)
  nombre          text NOT NULL,
  sucursal        text REFERENCES sucursales(codigo),
  activo          boolean NOT NULL DEFAULT true,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);

-- Las series pasan a colgar de una sucursal; tienda queda como texto legado
ALTER TABLE series ADD COLUMN sucursal text REFERENCES sucursales(codigo);
ALTER TABLE series ALTER COLUMN tienda DROP NOT NULL;

-- Facturas: vendedor opcional
ALTER TABLE facturas ADD COLUMN vendedor_id bigint REFERENCES vendedores(id);

-- Enlace de los datos de prueba, SOLO si existen (en una base limpia no hace nada)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM series WHERE serie IN ('A-CEN', 'A-SUR')) THEN
    INSERT INTO sucursales (codigo, nombre) VALUES
      ('CEN', 'Sucursal Central'),
      ('SUR', 'Sucursal Sur')
    ON CONFLICT DO NOTHING;
    UPDATE series SET sucursal = 'CEN' WHERE serie = 'A-CEN' AND sucursal IS NULL;
    UPDATE series SET sucursal = 'SUR' WHERE serie = 'A-SUR' AND sucursal IS NULL;
  END IF;
END $$;
