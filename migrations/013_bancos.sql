-- ============================================================================
-- 013 — F3: BANCOS Y CHEQUES.
--   * Cuentas bancarias con su chequera: el número de cheque sale de
--     ultimo_cheque de la cuenta, con row-lock (mismo patrón sagrado).
--   * Movimientos: cheque / transferencia (salidas), depósito / crédito
--     bancario (entradas), débito bancario (comisiones). Asiento automático.
--   * Pago a proveedores: el movimiento puede aplicarse a compras al crédito
--     (baja la CxP igual que el recibo baja la CxC).
--   * Conciliación: bandera por movimiento (importar estado de cuenta: F3b).
--   * Multimoneda: v1 registra en NIO; el soporte USD pleno queda pendiente.
-- ============================================================================

CREATE TABLE cuentas_bancarias (
  id              bigserial PRIMARY KEY,
  banco           text NOT NULL,             -- BAC, Lafise, Banpro…
  nombre          text NOT NULL,             -- 'BAC córdobas operativa'
  numero          text NOT NULL,             -- nº de cuenta en el banco
  moneda          char(3) NOT NULL DEFAULT 'NIO' CHECK (moneda IN ('NIO','USD')),
  cuenta_contable text NOT NULL REFERENCES cuentas(codigo),
  ultimo_cheque   int NOT NULL DEFAULT 0 CHECK (ultimo_cheque >= 0),
  activa          boolean NOT NULL DEFAULT true,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);

CREATE TABLE movimientos_banco (
  id                 bigserial PRIMARY KEY,
  cuenta_bancaria_id bigint NOT NULL REFERENCES cuentas_bancarias(id),
  fecha              date NOT NULL,
  tipo               text NOT NULL CHECK (tipo IN
                       ('cheque','transferencia','deposito','debito_bancario','credito_bancario')),
  numero             int,                    -- nº de cheque (solo tipo cheque)
  beneficiario       text,
  tercero_id         bigint REFERENCES terceros(id),
  concepto           text NOT NULL,
  monto              numeric(14,2) NOT NULL CHECK (monto > 0),
  estado             text NOT NULL DEFAULT 'emitido' CHECK (estado IN ('emitido','anulado')),
  conciliado         boolean NOT NULL DEFAULT false,
  conciliado_en      timestamptz,
  asiento_id         bigint REFERENCES asientos(id),
  creado_por         uuid,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_por    uuid,
  actualizado_en     timestamptz
);
CREATE UNIQUE INDEX cheques_numero_unico ON movimientos_banco (cuenta_bancaria_id, numero)
  WHERE numero IS NOT NULL;
CREATE INDEX movbanco_cuenta ON movimientos_banco (cuenta_bancaria_id, fecha);
CREATE INDEX movbanco_tercero ON movimientos_banco (tercero_id) WHERE tercero_id IS NOT NULL;

-- Aplicaciones del pago a compras al crédito (baja la CxP por documento)
CREATE TABLE pago_aplicaciones (
  id                  bigserial PRIMARY KEY,
  movimiento_banco_id bigint NOT NULL REFERENCES movimientos_banco(id),
  compra_id           bigint NOT NULL REFERENCES compras(id),
  monto               numeric(14,2) NOT NULL CHECK (monto > 0)
);
CREATE INDEX pago_aplicaciones_compra ON pago_aplicaciones (compra_id);
CREATE INDEX pago_aplicaciones_mov    ON pago_aplicaciones (movimiento_banco_id);

-- El asiento de bancos aprende nuevos orígenes
ALTER TABLE asientos DROP CONSTRAINT asientos_tipo_origen_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_tipo_origen_check
  CHECK (tipo_origen IN (
    'manual','apertura','factura','recibo','nota_credito','nota_debito',
    'cheque','transferencia','deposito','compra','pago','poliza',
    'ajuste','cierre','contra_asiento','banco'));

-- Permisos del módulo bancos
INSERT INTO permisos (rol, modulo, accion) VALUES
  ('contador', 'bancos', 'ver'),
  ('contador', 'bancos', 'crear'),
  ('contador', 'bancos', 'anular'),
  ('contador', 'bancos', 'cerrar'),   -- conciliar
  ('cajero',   'bancos', 'ver'),
  ('cajero',   'bancos', 'crear'),    -- emite cheques pero NO anula (plan §4)
  ('consulta', 'bancos', 'ver')
ON CONFLICT DO NOTHING;
