export type TipoCuenta = 'activo' | 'pasivo' | 'capital' | 'ingreso' | 'costo' | 'gasto';

export interface Cuenta {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  padre: string | null;
  nivel: number;
  es_detalle: boolean;
  moneda: 'NIO' | 'USD';
  activa: boolean;
}

export interface Periodo {
  ano_mes: string;
  estado: 'abierto' | 'cerrado';
  cerrado_por: string | null;
  cerrado_en: string | null;
}

export interface Movimiento {
  id: number;
  cuenta: string;
  debito: string | number;
  credito: string | number;
  moneda: string;
  tercero_id: number | null;
  documento_ref: string | null;
}

export interface Asiento {
  id: number;
  fecha: string;
  ano_mes: string;
  tipo_origen: string;
  concepto: string;
  anulado: boolean;
  anulado_por: number | null;
  movimientos: Movimiento[];
}

export interface FilaBalanza extends Cuenta {
  debitos: number;
  creditos: number;
  saldo: number;
}

export interface RespuestaBalanza {
  hasta: string | null;
  cuentas: FilaBalanza[];
  totales: { debitos: number; creditos: number; cuadrada: boolean };
}

export interface LineaMayor {
  fecha: string;
  asiento_id: number;
  tipo_origen: string;
  concepto: string;
  anulado: boolean;
  debito: string | number;
  credito: string | number;
  documento_ref: string | null;
  saldo: number;
}

export interface RespuestaMayor {
  cuenta: { codigo: string; nombre: string };
  desde: string | null;
  hasta: string | null;
  saldo_inicial: number;
  movimientos: LineaMayor[];
  saldo_final: number;
}
