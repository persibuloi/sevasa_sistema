-- ============================================================================
-- 019 — MULTIPÓLIZA: una póliza puede consolidar productos de VARIOS
-- proveedores (cada línea con su tercero). Al liquidar, el FOB se acredita a
-- la CxP de CADA proveedor por su parte. Además la póliza recuerda de qué
-- órdenes de compra se armó (para marcarlas recibidas y trazabilidad).
-- ============================================================================

ALTER TABLE poliza_lineas ADD COLUMN tercero_id bigint REFERENCES terceros(id);
ALTER TABLE polizas ADD COLUMN ordenes_ids bigint[] NOT NULL DEFAULT '{}';
