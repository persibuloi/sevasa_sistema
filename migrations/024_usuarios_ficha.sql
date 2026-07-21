-- ============================================================================
-- 024 — FICHA DE USUARIO Y AMARRES OPERATIVOS.
--   * Datos personales (la foto queda para después, por decisión del usuario).
--   * Amarres DUROS: usuario con sucursal solo usa series de SU sucursal;
--     usuario con bodega solo origina traslados desde SU bodega (puede
--     enviar hacia otras). Sin amarre (admin/contador) = sin restricción.
--   * Los usuarios NUNCA se borran (viven en bitácora y documentos):
--     solo se desactivan.
-- ============================================================================

ALTER TABLE usuarios ADD COLUMN cedula        text;
ALTER TABLE usuarios ADD COLUMN telefono      text;
ALTER TABLE usuarios ADD COLUMN direccion     text;
ALTER TABLE usuarios ADD COLUMN cargo         text;
ALTER TABLE usuarios ADD COLUMN fecha_ingreso date;
ALTER TABLE usuarios ADD COLUMN notas         text;
ALTER TABLE usuarios ADD COLUMN sucursal      text REFERENCES sucursales(codigo);
ALTER TABLE usuarios ADD COLUMN bodega        text REFERENCES bodegas(codigo);
ALTER TABLE usuarios ADD COLUMN vendedor_id   bigint REFERENCES vendedores(id);
