-- ============================================================================
-- 001 — NÚCLEO CONTABLE (partida doble)
-- Reglas duras (§3 del plan):
--   1. Asiento descuadrado = imposible de guardar (constraint trigger diferido).
--   2. Período cerrado = inmutable (trigger a nivel BD).
--   3. Nada se borra: se anula con contra-asiento.
--   4. Toda tabla lleva auditoría (creado_por/en, actualizado_por/en).
-- Multimoneda desde el día 1: montos siempre en NIO (córdobas); si el
-- documento es en USD se guardan moneda, tipo_cambio y monto_origen.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Catálogo de cuentas
-- ---------------------------------------------------------------------------
CREATE TABLE cuentas (
  codigo          text PRIMARY KEY,
  nombre          text NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('activo','pasivo','capital','ingreso','costo','gasto')),
  padre           text REFERENCES cuentas(codigo),
  nivel           int  NOT NULL DEFAULT 1 CHECK (nivel >= 1),
  es_detalle      boolean NOT NULL DEFAULT true,  -- solo cuentas de detalle reciben movimientos
  moneda          char(3) NOT NULL DEFAULT 'NIO' CHECK (moneda IN ('NIO','USD')),
  activa          boolean NOT NULL DEFAULT true,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);

-- ---------------------------------------------------------------------------
-- Períodos contables (candado mensual)
-- ---------------------------------------------------------------------------
CREATE TABLE periodos (
  ano_mes     char(7) PRIMARY KEY CHECK (ano_mes ~ '^\d{4}-\d{2}$'),
  estado      text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  cerrado_por uuid,
  cerrado_en  timestamptz
);

-- ---------------------------------------------------------------------------
-- Terceros (clientes y proveedores unificados)
-- ---------------------------------------------------------------------------
CREATE TABLE terceros (
  id              bigserial PRIMARY KEY,
  ruc             text,                            -- RUC o cédula
  nombre          text NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('cliente','proveedor','ambos','otro')),
  terminos_dias   int NOT NULL DEFAULT 0 CHECK (terminos_dias >= 0),
  activo          boolean NOT NULL DEFAULT true,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);
CREATE UNIQUE INDEX terceros_ruc_unico ON terceros (ruc) WHERE ruc IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Tipo de cambio oficial (BCN): córdobas por 1 USD, un valor por día
-- ---------------------------------------------------------------------------
CREATE TABLE tipos_cambio (
  fecha date PRIMARY KEY,
  tasa  numeric(12,6) NOT NULL CHECK (tasa > 0)
);

-- ---------------------------------------------------------------------------
-- Asientos y movimientos
-- ---------------------------------------------------------------------------
CREATE TABLE asientos (
  id          bigserial PRIMARY KEY,
  fecha       date NOT NULL,
  ano_mes     char(7) NOT NULL REFERENCES periodos(ano_mes),
  tipo_origen text NOT NULL CHECK (tipo_origen IN (
                'manual','apertura','factura','recibo','nota_credito','nota_debito',
                'cheque','transferencia','deposito','compra','pago','poliza',
                'ajuste','cierre','contra_asiento')),
  origen_id   bigint,                              -- id del documento que lo generó
  concepto    text NOT NULL,
  anulado     boolean NOT NULL DEFAULT false,
  anulado_por bigint REFERENCES asientos(id),      -- contra-asiento que lo anula
  creado_por  uuid,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asientos_fecha   ON asientos (fecha);
CREATE INDEX asientos_ano_mes ON asientos (ano_mes);
CREATE INDEX asientos_origen  ON asientos (tipo_origen, origen_id);

CREATE TABLE movimientos (
  id            bigserial PRIMARY KEY,
  asiento_id    bigint NOT NULL REFERENCES asientos(id),
  cuenta        text   NOT NULL REFERENCES cuentas(codigo),
  debito        numeric(14,2) NOT NULL DEFAULT 0 CHECK (debito  >= 0),
  credito       numeric(14,2) NOT NULL DEFAULT 0 CHECK (credito >= 0),
  -- exactamente uno de los dos es cero y el otro mayor que cero:
  CONSTRAINT movimiento_un_solo_lado CHECK ((debito = 0) <> (credito = 0)),
  moneda        char(3) NOT NULL DEFAULT 'NIO' CHECK (moneda IN ('NIO','USD')),
  tipo_cambio   numeric(12,6) CHECK (tipo_cambio IS NULL OR tipo_cambio > 0),
  monto_origen  numeric(14,2),                     -- monto en la moneda del documento
  CONSTRAINT moneda_extranjera_completa
    CHECK (moneda = 'NIO' OR (tipo_cambio IS NOT NULL AND monto_origen IS NOT NULL)),
  tercero_id    bigint REFERENCES terceros(id),
  documento_ref text
);
CREATE INDEX movimientos_asiento ON movimientos (asiento_id);
CREATE INDEX movimientos_cuenta  ON movimientos (cuenta);
CREATE INDEX movimientos_tercero ON movimientos (tercero_id) WHERE tercero_id IS NOT NULL;

-- ============================================================================
-- REGLA 1 — Cuadre: SUM(debito) = SUM(credito) por asiento.
-- Constraint trigger DIFERIDO al commit: mientras se insertan los movimientos
-- uno a uno el asiento está transitoriamente descuadrado; al confirmar la
-- transacción debe cuadrar o TODO se revierte.
-- ============================================================================
CREATE FUNCTION verificar_cuadre() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_asiento    bigint;
  v_diferencia numeric;
  v_lineas     int;
BEGIN
  v_asiento := COALESCE(NEW.asiento_id, OLD.asiento_id);
  SELECT COALESCE(SUM(debito) - SUM(credito), 0), COUNT(*)
    INTO v_diferencia, v_lineas
    FROM movimientos WHERE asiento_id = v_asiento;
  IF v_lineas < 2 THEN
    RAISE EXCEPTION 'Asiento %: necesita al menos 2 movimientos (tiene %)', v_asiento, v_lineas;
  END IF;
  IF v_diferencia <> 0 THEN
    RAISE EXCEPTION 'Asiento % descuadrado: débitos - créditos = %', v_asiento, v_diferencia;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_verificar_cuadre
  AFTER INSERT OR UPDATE OR DELETE ON movimientos
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verificar_cuadre();

-- ============================================================================
-- REGLA 2 — Período cerrado = inmutable. Además: coherencia fecha/ano_mes,
-- solo cuentas de detalle activas reciben movimientos.
-- ============================================================================
CREATE FUNCTION proteger_asiento() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los asientos no se borran: se anulan con contra-asiento (asiento %)', OLD.id;
  END IF;
  IF NEW.ano_mes <> to_char(NEW.fecha, 'YYYY-MM') THEN
    RAISE EXCEPTION 'Asiento con fecha % no corresponde al período %', NEW.fecha, NEW.ano_mes;
  END IF;
  SELECT estado INTO v_estado FROM periodos WHERE ano_mes = NEW.ano_mes;
  IF v_estado IS DISTINCT FROM 'abierto' THEN
    RAISE EXCEPTION 'El período % no está abierto', NEW.ano_mes;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.ano_mes <> NEW.ano_mes THEN
    SELECT estado INTO v_estado FROM periodos WHERE ano_mes = OLD.ano_mes;
    IF v_estado IS DISTINCT FROM 'abierto' THEN
      RAISE EXCEPTION 'El período % no está abierto', OLD.ano_mes;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_proteger_asiento
  BEFORE INSERT OR UPDATE OR DELETE ON asientos
  FOR EACH ROW EXECUTE FUNCTION proteger_asiento();

CREATE FUNCTION proteger_movimiento() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_estado  text;
  v_cuenta  cuentas%ROWTYPE;
  v_asiento bigint;
BEGIN
  v_asiento := COALESCE(NEW.asiento_id, OLD.asiento_id);
  SELECT p.estado INTO v_estado
    FROM asientos a JOIN periodos p ON p.ano_mes = a.ano_mes
    WHERE a.id = v_asiento;
  IF v_estado IS DISTINCT FROM 'abierto' THEN
    RAISE EXCEPTION 'El asiento % pertenece a un período cerrado', v_asiento;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;  -- permitido solo en período abierto (correcciones pre-cierre)
  END IF;
  SELECT * INTO v_cuenta FROM cuentas WHERE codigo = NEW.cuenta;
  IF NOT v_cuenta.es_detalle THEN
    RAISE EXCEPTION 'La cuenta % (%) es de mayor: solo cuentas de detalle reciben movimientos',
      v_cuenta.codigo, v_cuenta.nombre;
  END IF;
  IF NOT v_cuenta.activa THEN
    RAISE EXCEPTION 'La cuenta % (%) está inactiva', v_cuenta.codigo, v_cuenta.nombre;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_proteger_movimiento
  BEFORE INSERT OR UPDATE OR DELETE ON movimientos
  FOR EACH ROW EXECUTE FUNCTION proteger_movimiento();

-- ============================================================================
-- Vista base: balanza de comprobación (débitos/créditos acumulados por cuenta).
-- Incluye TODOS los asientos: un asiento anulado y su contra-asiento se netean
-- entre sí — excluir solo los anulados descuadraría la balanza.
-- ============================================================================
CREATE VIEW v_balanza AS
SELECT c.codigo,
       c.nombre,
       c.tipo,
       c.nivel,
       COALESCE(SUM(m.debito),  0) AS debitos,
       COALESCE(SUM(m.credito), 0) AS creditos,
       COALESCE(SUM(m.debito) - SUM(m.credito), 0) AS saldo
FROM cuentas c
LEFT JOIN movimientos m ON m.cuenta = c.codigo
GROUP BY c.codigo, c.nombre, c.tipo, c.nivel;