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

export interface Serie {
  serie: string;
  tienda: string | null;
  sucursal: string | null;
  sucursal_nombre?: string | null;
  tipo: 'sistema' | 'manual';
  documento: 'factura' | 'recibo' | 'nota_credito';
  prefijo: string;
  ultimo_numero: number;
  numero_desde: number;
  activa: boolean;
}

export interface ControlSerie {
  serie: Serie;
  emitidas: number;
  anuladas: number;
  borradores: number;
  minimo: number;
  maximo: number;
  huecos: number[];
}

export interface Sucursal {
  codigo: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  cuenta_caja: string | null;
  activa: boolean;
}

export interface Bodega {
  codigo: string;
  nombre: string;
  sucursal: string;
  sucursal_nombre?: string | null;
  activa: boolean;
}

export interface Vendedor {
  id: number;
  codigo: string | null;
  nombre: string;
  sucursal: string | null;
  sucursal_nombre?: string | null;
  activo: boolean;
}

export interface ClaveConfig {
  clave: string;
  valor: string;
  descripcion: string | null;
}

export interface Cliente {
  id: number;
  ruc: string | null;
  nombre: string;
  tipo: string;
  terminos_dias: number;
  activo: boolean;
  facturas_emitidas?: number;
}

export interface Producto {
  id: number;
  codigo: string;
  nombre: string;
  unidad: string;
  categoria: string | null;
  precio_venta: string | number;
  costo_promedio?: string | number;
  existencia?: string | number;
  existencia_bodega?: string | number;
  activo: boolean;
}

export interface LineaCompra {
  id?: number;
  producto_id: number;
  producto_codigo?: string;
  producto_nombre?: string;
  cantidad: string | number;
  costo_unitario: string | number;
  total?: string | number;
}

export interface Compra {
  id: number;
  orden_compra_id: number | null;
  tercero_id: number;
  proveedor?: string;
  numero_documento: string;
  fecha: string;
  tipo_pago: 'contado' | 'credito';
  bodega: string;
  bodega_nombre?: string;
  estado: 'borrador' | 'registrada' | 'anulada';
  subtotal: string | number;
  iva: string | number;
  total: string | number;
  notas: string | null;
  asiento_id: number | null;
  lineas?: LineaCompra[];
}

export interface LineaOrdenCompra {
  id?: number;
  producto_id: number | null;
  producto_codigo?: string | null;
  descripcion: string;
  cantidad: string | number;
  costo_unitario: string | number;
  total?: string | number;
}

export interface OrdenCompra {
  id: number;
  tercero_id: number;
  proveedor?: string;
  fecha: string;
  bodega: string | null;
  bodega_nombre?: string | null;
  estado: 'borrador' | 'aprobada' | 'recibida' | 'anulada';
  notas: string | null;
  total?: string | number;
  lineas?: LineaOrdenCompra[];
}

export interface LineaFactura {
  id?: number;
  descripcion: string;
  cantidad: string | number;
  precio_unitario: string | number;
  total?: string | number;
  producto_id?: number | null;
}

export interface Factura {
  id: number;
  serie: string;
  numero: number | null;
  numero_completo: string | null;
  fecha: string;
  tercero_id: number;
  cliente?: string;
  tienda?: string;
  tipo_pago: 'contado' | 'credito';
  estado: 'borrador' | 'emitida' | 'anulada';
  origen: string;
  subtotal: string | number;
  iva: string | number;
  total: string | number;
  notas: string | null;
  asiento_id: number | null;
  vendedor_id: number | null;
  vendedor?: string | null;
  lineas?: LineaFactura[];
}

export interface FacturaPendiente {
  id: number;
  numero_completo: string;
  fecha: string;
  total: string | number;
  tercero_id: number;
  cliente: string;
  terminos_dias: number;
  cobrado: string | number;
  acreditado: string | number;
  saldo: string | number;
  vence?: string;
  dias_vencida?: number;
  bucket?: string;
}

export interface ResumenCartera {
  corriente: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_mas: number;
  total: number;
}

export interface Recibo {
  id: number;
  numero_completo: string;
  fecha: string;
  tercero_id: number;
  cliente?: string;
  forma_pago: string;
  referencia: string | null;
  total: string | number;
  estado: 'emitido' | 'anulado';
  notas: string | null;
}

export interface NotaCredito {
  id: number;
  numero_completo: string;
  fecha: string;
  factura_id: number;
  factura?: string;
  cliente?: string;
  tipo: 'devolucion' | 'rebaja';
  motivo: string;
  subtotal: string | number;
  iva: string | number;
  total: string | number;
  estado: 'emitida' | 'anulada';
}

export interface RespuestaMayor {
  cuenta: { codigo: string; nombre: string };
  desde: string | null;
  hasta: string | null;
  saldo_inicial: number;
  movimientos: LineaMayor[];
  saldo_final: number;
}
