import { useEffect, useMemo, useState } from 'react';
import { api, ErrorApi } from '../api';
import type { Bodega, Cliente, Cuenta, Producto } from '../tipos';

/** Apertura de saldos iniciales: se pegan las 4 hojas desde Excel (tab) o
 *  CSV, se valida contra el catálogo y las cuentas de enlace, y se carga
 *  TODO en una transacción. Incluye la zona de peligro para limpiar los
 *  datos de prueba antes del arranque real. */

interface Estado {
  cargada: boolean;
  apertura: { id: number; fecha: string; concepto: string; total: string | number } | null;
  auxiliares: { clientes: number; proveedores: number; inventario: number } | null;
  datos_actuales: Record<string, number>;
}

interface Resultado {
  valida: boolean;
  errores: string[];
  avisos: string[];
  totales: Record<string, number>;
  filas: { balanza: number; clientes: number; proveedores: number; inventario: number };
}

/** Números como vienen de Excel Nicaragua: 1,234.56 — se toleran miles con coma. */
function limpiarNumero(s: string): number {
  const limpio = s.trim().replace(/\s/g, '');
  if (limpio === '') return 0;
  // si hay coma Y punto, la coma es de miles; si solo hay coma, es decimal
  const normal = limpio.includes('.') ? limpio.replace(/,/g, '') : limpio.replace(',', '.');
  return Number(normal);
}

function partir(linea: string): string[] {
  const sep = linea.includes('\t') ? '\t' : linea.includes(';') ? ';' : ',';
  return linea.split(sep).map((x) => x.trim());
}

/** Parsea un bloque pegado; salta la fila de encabezado si la trae. */
function filas(texto: string): string[][] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(partir)
    .filter((cols, i) => !(i === 0 && cols.every((c) => Number.isNaN(limpiarNumero(c)) || c === '')));
}

/** Lee .xlsx/.xls (primera hoja) o .csv/.txt y lo devuelve como texto tabulado.
 *  Los CSV de Excel en español suelen venir en ANSI: si no es UTF-8 válido se
 *  decodifica como windows-1252 para no perder acentos y eñes. */
async function leerArchivo(archivo: File): Promise<string> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.xlsx') || nombre.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0] ?? ''];
    return hoja ? XLSX.utils.sheet_to_csv(hoja, { FS: '\t', blankrows: false }) : '';
  }
  const buffer = await archivo.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function BotonArchivo({ alLeer }: { alLeer: (texto: string) => void }) {
  return (
    <label className="text-xs font-semibold text-verde cursor-pointer hover:underline shrink-0">
      📄 subir Excel/CSV
      <input
        type="file"
        accept=".csv,.tsv,.txt,.xls,.xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void leerArchivo(f).then(alLeer);
          e.target.value = '';
        }}
      />
    </label>
  );
}

// Las hojas sobreviven a un refresco del navegador (se limpian al cargar la apertura)
const RECUERDO = 'sevasa-apertura';
function recordar(clave: string): string {
  try { return localStorage.getItem(`${RECUERDO}:${clave}`) ?? ''; } catch { return ''; }
}

export default function SaldosIniciales() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [fecha, setFecha] = useState(() => recordar('fecha'));
  const [txtBalanza, setTxtBalanza] = useState(() => recordar('balanza'));
  const [txtClientes, setTxtClientes] = useState(() => recordar('clientes'));
  const [txtProveedores, setTxtProveedores] = useState(() => recordar('proveedores'));
  const [txtInventario, setTxtInventario] = useState(() => recordar('inventario'));

  useEffect(() => {
    try {
      localStorage.setItem(`${RECUERDO}:fecha`, fecha);
      localStorage.setItem(`${RECUERDO}:balanza`, txtBalanza);
      localStorage.setItem(`${RECUERDO}:clientes`, txtClientes);
      localStorage.setItem(`${RECUERDO}:proveedores`, txtProveedores);
      localStorage.setItem(`${RECUERDO}:inventario`, txtInventario);
    } catch { /* almacenamiento lleno o bloqueado: solo se pierde el respaldo */ }
  }, [fecha, txtBalanza, txtClientes, txtProveedores, txtInventario]);
  const [crearTerceros, setCrearTerceros] = useState(true);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [fraseLimpiar, setFraseLimpiar] = useState('');
  const [incluirCatalogo, setIncluirCatalogo] = useState(false);
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [reporteExi, setReporteExi] = useState<{
    encabezado: string[]; filas: string[][]; candidatas: string[]; formato: 'ancho' | 'largo';
  } | null>(null);
  const [mapeo, setMapeo] = useState<Record<string, string>>({});
  const [tipoCambio, setTipoCambio] = useState('');

  const cargarEstado = () => api.get<Estado>('/apertura').then(setEstado).catch(() => undefined);
  useEffect(() => {
    void cargarEstado();
    api.get<Bodega[]>('/configuracion/bodegas').then((b) => setBodegas(b.filter((x) => x.activa))).catch(() => undefined);
  }, []);

  // Las filas de la plantilla que quedaron sin monto se saltan (son el
  // catálogo pre-llenado); un monto mal escrito SÍ llega y el backend lo canta.
  const paquete = useMemo(() => ({
    fecha,
    crear_terceros: crearTerceros,
    balanza: filas(txtBalanza).flatMap((c) => {
      const d = (c[1] ?? '').trim();
      const cr = (c[2] ?? '').trim();
      if (d === '' && cr === '') return [];
      return [{ cuenta: c[0] ?? '', debito: limpiarNumero(d), credito: limpiarNumero(cr) }];
    }),
    clientes: filas(txtClientes).flatMap((c) => {
      const tiene3 = c.length >= 3;
      const saldoStr = ((tiene3 ? c[2] : c[1]) ?? '').trim();
      if (saldoStr === '') return [];
      return [{ ruc: tiene3 ? c[0] : undefined, nombre: (tiene3 ? c[1] : c[0]) ?? '', saldo: limpiarNumero(saldoStr) }];
    }),
    proveedores: filas(txtProveedores).flatMap((c) => {
      const tiene3 = c.length >= 3;
      const saldoStr = ((tiene3 ? c[2] : c[1]) ?? '').trim();
      if (saldoStr === '') return [];
      return [{ ruc: tiene3 ? c[0] : undefined, nombre: (tiene3 ? c[1] : c[0]) ?? '', saldo: limpiarNumero(saldoStr) }];
    }),
    inventario: filas(txtInventario).flatMap((c) => {
      const cantidadStr = (c[2] ?? '').trim();
      const costoStr = (c[3] ?? '').trim();
      if (cantidadStr === '' && costoStr === '') return [];
      return [{ producto: c[0] ?? '', bodega: c[1] ?? '', cantidad: limpiarNumero(cantidadStr), costo_unitario: limpiarNumero(costoStr) }];
    }),
  }), [fecha, crearTerceros, txtBalanza, txtClientes, txtProveedores, txtInventario]);

  /** Plantilla Excel pre-llenada con el catálogo real: solo se ponen montos. */
  async function descargarPlantilla() {
    setAviso('');
    setOcupado(true);
    try {
      const [XLSX, cuentas, clientes, proveedores, productos] = await Promise.all([
        import('xlsx'),
        api.get<Cuenta[]>('/cuentas'),
        api.get<Cliente[]>('/clientes'),
        api.get<Array<{ ruc: string | null; nombre: string; activo: boolean }>>('/proveedores'),
        api.get<Producto[]>('/productos'),
      ]);
      const hoja = (datos: Array<Array<string | number>>, anchos: number[]) => {
        const ws = XLSX.utils.aoa_to_sheet(datos);
        ws['!cols'] = anchos.map((wch) => ({ wch }));
        return ws;
      };
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja([
        ['PLANTILLA DE SALDOS INICIALES — SEVASA CONTABLE'],
        [''],
        ['Cada hoja ya trae el catálogo del sistema: SOLO llená los montos.'],
        ['Las filas que dejés sin monto se ignoran solas.'],
        [''],
        ['1 · Balanza: el saldo de cada cuenta en débito O crédito. Débitos = créditos al centavo.'],
        ['2 · Clientes: un saldo global por cliente. La suma debe ser IGUAL a la cuenta CxC de la balanza.'],
        ['3 · Proveedores: igual, contra la cuenta CxP. Quedan pagables desde Bancos.'],
        ['4 · Inventario: bodega, cantidad y costo unitario. Cantidad × costo debe sumar la cuenta Inventario.'],
        [''],
        ['Al terminar: Contabilidad → Saldos iniciales → "Subir plantilla llena" → Validar → Cargar apertura.'],
      ], [105]), 'Instrucciones');
      XLSX.utils.book_append_sheet(libro, hoja([
        ['cuenta', 'debito', 'credito', 'nombre (referencia)'],
        ...cuentas.filter((c) => c.es_detalle && c.activa).map((c) => [c.codigo, '', '', c.nombre]),
      ], [16, 14, 14, 45]), 'Balanza');
      XLSX.utils.book_append_sheet(libro, hoja([
        ['ruc', 'nombre', 'saldo'],
        ...clientes.filter((c) => c.activo).map((c) => [c.ruc ?? '', c.nombre, '']),
      ], [16, 45, 14]), 'Clientes');
      XLSX.utils.book_append_sheet(libro, hoja([
        ['ruc', 'nombre', 'saldo'],
        ...proveedores.filter((p) => p.activo).map((p) => [p.ruc ?? '', p.nombre, '']),
      ], [16, 45, 14]), 'Proveedores');
      XLSX.utils.book_append_sheet(libro, hoja([
        ['codigo', 'bodega', 'cantidad', 'costo_unitario'],
        ...productos.filter((p) => p.activo).map((p) => [p.codigo, '', '', '']),
      ], [16, 12, 12, 15]), 'Inventario');
      XLSX.writeFile(libro, 'Plantilla-Saldos-Iniciales-SEVASA.xlsx');
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'No se pudo generar la plantilla'}`);
    } finally {
      setOcupado(false);
    }
  }

  /** Importa la balanza DETALLADA exportada del sistema viejo (detalle.xls):
   *  el backend separa clientes/proveedores/inventario, crea el catálogo de
   *  cuentas con el código viejo en guiones y devuelve las hojas armadas. */
  async function importarBalanzaVieja(archivo: File) {
    setAviso('');
    setOcupado(true);
    try {
      const XLSX = await import('xlsx');
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
      const ws = libro.Sheets[libro.SheetNames[0] ?? ''];
      const crudas: string[][] = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) : [];
      const encabezado = crudas.findIndex((r) => String(r[0] ?? '').toLowerCase().includes('cod.nivel'));
      if (encabezado === -1) {
        setAviso('❌ No parece la balanza detallada: falta la columna "Cod.Nivel 1"');
        return;
      }
      const filasDetalle = crudas.slice(encabezado + 1)
        .filter((r) => String(r[2] ?? '').trim() !== '')
        .map((r) => ({
          grupo: String(r[0] ?? ''), grupo_nombre: String(r[1] ?? ''),
          codigo: String(r[2] ?? ''), nombre: String(r[3] ?? ''),
          final: limpiarNumero(String(r[8] ?? '0')),
        }));
      const r = await api.post<{
        balanza: Array<{ cuenta: string; debito: number; credito: number }>;
        clientes: Array<{ nombre: string; saldo: number }>;
        proveedores: Array<{ nombre: string; saldo: number }>;
        cuentas_creadas: number;
        avisos: string[];
      }>('/apertura/convertir-detalle', { filas: filasDetalle });
      setTxtBalanza(r.balanza.map((b) => `${b.cuenta}\t${b.debito || ''}\t${b.credito || ''}`).join('\n'));
      setTxtClientes(r.clientes.map((c) => `${c.nombre}\t${c.saldo}`).join('\n'));
      setTxtProveedores(r.proveedores.map((p) => `${p.nombre}\t${p.saldo}`).join('\n'));
      setResultado(null);
      setAviso([
        `✅ Balanza convertida: ${r.balanza.length} cuentas (${r.cuentas_creadas} creadas en el catálogo), ${r.clientes.length} clientes, ${r.proveedores.length} proveedores`,
        ...r.avisos.map((a) => `⚠ ${a}`),
      ].join('\n'));
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'No se pudo convertir la balanza'}`);
    } finally {
      setOcupado(false);
    }
  }

  // Columnas del reporte de existencias que NO son bodegas
  const NO_BODEGA = new Set([
    'codigo_detalle', 'nombre', 'nombre2', 'existencia', 'exisinaverias',
    'precio_dolar', 'garantia_meses', 'costo', 'costo_dolar', 'nivel2', 'nivel3', 'nivel4',
  ]);

  /** Lee el reporte de existencias del sistema viejo y prepara el mapeo.
   *  Soporta dos formatos:
   *   - ANCHO: una fila por producto, una columna por ubicación (CODIGO_DETALLE, COSTO en C$)
   *   - LARGO: una fila por producto-bodega (CODIGO, CODIGO_BODEGA, EXISTENCIA, COSTO_DOLAR) */
  async function leerReporteExistencias(archivo: File) {
    setAviso('');
    try {
      const XLSX = await import('xlsx');
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
      const ws = libro.Sheets[libro.SheetNames[0] ?? ''];
      const crudas: string[][] = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) : [];
      const tiene = (fila: string[], col: string) => fila.some((c) => String(c).trim().toUpperCase() === col);
      const iLargo = crudas.findIndex((r) => tiene(r, 'CODIGO_BODEGA'));
      const iAncho = crudas.findIndex((r) => tiene(r, 'CODIGO_DETALLE'));
      if (iLargo !== -1) {
        const encabezado = crudas[iLargo]!.map((c) => String(c).trim());
        const iBodega = encabezado.findIndex((c) => c.toUpperCase() === 'CODIGO_BODEGA');
        const filasDatos = crudas.slice(iLargo + 1).filter((r) => String(r[0] ?? '').trim() !== '');
        const candidatas = [...new Set(filasDatos.map((r) => String(r[iBodega] ?? '').trim()).filter(Boolean))]
          .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
        setReporteExi({ encabezado, filas: filasDatos, candidatas, formato: 'largo' });
        setMapeo({});
        setAviso(`✅ Reporte leído (una fila por producto-bodega): ${filasDatos.length} filas, ${candidatas.length} bodegas del sistema viejo. Mapeá cada código de bodega y poné el tipo de cambio (los costos vienen en US$).`);
        return;
      }
      if (iAncho !== -1) {
        const encabezado = crudas[iAncho]!.map((c) => String(c).trim());
        const candidatas = encabezado.filter((c) => c !== '' && !NO_BODEGA.has(c.toLowerCase()));
        setReporteExi({ encabezado, filas: crudas.slice(iAncho + 1), candidatas, formato: 'ancho' });
        setMapeo({});
        setAviso(`✅ Reporte leído: ${crudas.length - iAncho - 1} productos. Ahora mapeá cada columna a su bodega (las que dejés en blanco se ignoran).`);
        return;
      }
      setAviso('❌ No parece un reporte de existencias: falta la columna CODIGO_DETALLE o CODIGO_BODEGA');
    } catch {
      setAviso('❌ No se pudo leer el reporte de existencias');
    }
  }

  /** Recalcula la cuenta 1-1-3 y el ajuste 3-99 cuando el kardex trae otro total. */
  function ajustarBalanzaInventario(totalInventario: number): boolean {
    const filasB = filas(txtBalanza).map((c) => ({
      cuenta: c[0] ?? '',
      deb: limpiarNumero((c[1] ?? '').trim() || '0') || 0,
      cred: limpiarNumero((c[2] ?? '').trim() || '0') || 0,
    }));
    const inv = filasB.find((r) => r.cuenta === '1-1-3');
    if (!inv) return false;
    inv.deb = totalInventario;
    inv.cred = 0;
    const suma = filasB
      .filter((r) => r.cuenta !== '3-99')
      .reduce((t, r) => t + Math.round(r.deb * 100) - Math.round(r.cred * 100), 0);
    let ajuste = filasB.find((r) => r.cuenta === '3-99');
    if (!ajuste) {
      ajuste = { cuenta: '3-99', deb: 0, cred: 0 };
      filasB.push(ajuste);
    }
    ajuste.deb = suma < 0 ? -suma / 100 : 0;
    ajuste.cred = suma > 0 ? suma / 100 : 0;
    setTxtBalanza(filasB.map((r) => `${r.cuenta}\t${r.deb || ''}\t${r.cred || ''}`).join('\n'));
    return true;
  }

  /** Convierte el reporte con el mapeo elegido: crea productos y llena la hoja 4. */
  async function convertirExistencias() {
    if (!reporteExi) return;
    const columnas = Object.entries(mapeo).filter(([, b]) => b !== '');
    if (columnas.length === 0) {
      setAviso('❌ Mapeá al menos una columna a una bodega');
      return;
    }
    setAviso('');
    setOcupado(true);
    try {
      const idx = (nombre: string) => reporteExi.encabezado.findIndex((c) => c.toLowerCase() === nombre);
      const tc = limpiarNumero(tipoCambio);
      let filasEnvio: Array<{
        codigo: string; nombre: string; categoria?: string; costo: number;
        precio?: number; existencias: Array<{ bodega: string; cantidad: number }>;
      }>;

      if (reporteExi.formato === 'largo') {
        // Una fila por producto-bodega: CODIGO_PRODUCTO/CODIGO · NOMBRE · CODIGO_BODEGA ·
        // EXISTENCIA · COSTO (C$, preferido) o COSTO_DOLAR · PRECIO_DOLAR (opcional)
        const primera = (...nombres: string[]) => {
          for (const n of nombres) {
            const i = idx(n);
            if (i !== -1) return i;
          }
          return -1;
        };
        const iCodigo = primera('codigo_producto', 'codigo_producto2', 'codigo', 'codigo_detalle');
        const iNombre = idx('nombre');
        const iBodega = idx('codigo_bodega');
        const iCantidad = idx('existencia');
        const iCostoCS = idx('costo');
        const iCostoUS = idx('costo_dolar');
        const iPrecioUS = idx('precio_dolar');
        const faltantes = [
          ...(iCodigo === -1 ? ['CODIGO_PRODUCTO'] : []),
          ...(iBodega === -1 ? ['CODIGO_BODEGA'] : []),
          ...(iCantidad === -1 ? ['EXISTENCIA'] : []),
          ...(iCostoCS === -1 && iCostoUS === -1 ? ['COSTO o COSTO_DOLAR'] : []),
        ];
        if (faltantes.length > 0) {
          setAviso(`❌ No encuentro estas columnas en el reporte: ${faltantes.join(', ')} — columnas leídas: ${reporteExi.encabezado.filter(Boolean).join(', ')}`);
          return;
        }
        const enDolares = iCostoCS === -1;
        if (enDolares && !(tc > 0)) {
          setAviso('❌ Los costos vienen en US$ (COSTO_DOLAR): poné el tipo de cambio para convertirlos a córdobas');
          return;
        }
        const mapa = new Map(columnas);
        const porProducto = new Map<string, {
          nombre: string; valor: number; cantidadTotal: number; precio?: number; porBodega: Map<string, number>;
        }>();
        for (const r of reporteExi.filas) {
          const codigo = String(r[iCodigo] ?? '').trim();
          const bodegaVieja = String(r[iBodega] ?? '').trim();
          const bodega = mapa.get(bodegaVieja);
          if (!codigo || !bodega) continue; // bodegas sin mapear se ignoran
          const cantidad = limpiarNumero(String(r[iCantidad] ?? '0'));
          if (!(cantidad >= 0.005)) continue; // fuera los 1E-06 del sistema viejo
          const costoFila = limpiarNumero(String(r[enDolares ? iCostoUS : iCostoCS] ?? '0'));
          const costoCS = enDolares ? costoFila * tc : costoFila;
          const precioUS = iPrecioUS >= 0 ? limpiarNumero(String(r[iPrecioUS] ?? '0')) : 0;
          const p = porProducto.get(codigo) ?? {
            nombre: String(r[iNombre] ?? '').trim(), valor: 0, cantidadTotal: 0, porBodega: new Map<string, number>(),
          };
          p.valor += cantidad * costoCS;
          p.cantidadTotal += cantidad;
          p.porBodega.set(bodega, (p.porBodega.get(bodega) ?? 0) + cantidad);
          if (p.precio === undefined && tc > 0 && precioUS > 0) {
            p.precio = Math.round(precioUS * tc * 100) / 100;
          }
          porProducto.set(codigo, p);
        }
        filasEnvio = [...porProducto].map(([codigo, p]) => ({
          codigo,
          nombre: p.nombre,
          costo: p.cantidadTotal > 0 ? Math.round((p.valor / p.cantidadTotal) * 10000) / 10000 : 0,
          precio: p.precio,
          existencias: [...p.porBodega].map(([bodega, cantidad]) => ({ bodega, cantidad })),
        }));
      } else {
        const iCodigo = idx('codigo_detalle');
        const iNombre = idx('nombre');
        const iCosto = idx('costo');
        const iPrecio = idx('precio_dolar');
        const iCategoria = idx('nivel2');
        filasEnvio = reporteExi.filas
          .filter((r) => String(r[iCodigo] ?? '').trim() !== '')
          .map((r) => {
            const porBodega = new Map<string, number>();
            for (const [col, bodega] of columnas) {
              const iCol = reporteExi.encabezado.indexOf(col);
              const cantidad = limpiarNumero(String(r[iCol] ?? '0'));
              if (Number.isFinite(cantidad) && cantidad > 0) {
                porBodega.set(bodega, (porBodega.get(bodega) ?? 0) + cantidad);
              }
            }
            const precioDolar = iPrecio >= 0 ? limpiarNumero(String(r[iPrecio] ?? '0')) : 0;
            return {
              codigo: String(r[iCodigo] ?? '').trim(),
              nombre: String(r[iNombre] ?? '').trim(),
              categoria: iCategoria >= 0 ? String(r[iCategoria] ?? '').trim() : '',
              costo: limpiarNumero(String(r[iCosto] ?? '0')),
              precio: tc > 0 && precioDolar > 0 ? Math.round(precioDolar * tc * 100) / 100 : undefined,
              existencias: [...porBodega].map(([bodega, cantidad]) => ({ bodega, cantidad })),
            };
          });
      }
      if (filasEnvio.length === 0) {
        setAviso('❌ Ninguna fila del reporte coincidió con el mapeo — revisá que las bodegas mapeadas tengan existencias > 0');
        return;
      }
      const r = await api.post<{
        inventario: Array<{ producto: string; bodega: string; cantidad: number; costo_unitario: number }>;
        total: number; productos_creados: number; lineas: number; avisos: string[];
      }>('/apertura/convertir-existencias', { filas: filasEnvio, crear_productos: true });
      setTxtInventario(r.inventario.map((i) => `${i.producto}\t${i.bodega}\t${i.cantidad}\t${Number(i.costo_unitario.toFixed(4))}`).join('\n'));
      const ajustada = ajustarBalanzaInventario(r.total);
      setResultado(null);
      setReporteExi(null);
      setAviso([
        `✅ Existencias convertidas: ${r.lineas} líneas de kardex, ${r.productos_creados} productos creados, total C$ ${r.total.toLocaleString('es-NI', { minimumFractionDigits: 2 })}`,
        ajustada ? '✅ La cuenta de inventario 1-1-3 y el ajuste 3-99 de la balanza quedaron recalculados' :
          '⚠ No encontré la cuenta 1-1-3 en la balanza: ajustala vos para que coincida con el total del kardex',
        ...r.avisos.map((a) => `⚠ ${a}`),
      ].join('\n'));
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'No se pudo convertir el reporte'}`);
    } finally {
      setOcupado(false);
    }
  }

  /** Sube la plantilla llena: reparte sus hojas en los 4 bloques de un golpe. */
  async function subirPlantilla(archivo: File) {
    setAviso('');
    try {
      const XLSX = await import('xlsx');
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
      const texto = (busqueda: string): string | null => {
        const nombre = libro.SheetNames.find((s) => s.toLowerCase().includes(busqueda));
        const ws = nombre ? libro.Sheets[nombre] : undefined;
        return ws ? XLSX.utils.sheet_to_csv(ws, { FS: '\t', blankrows: false }) : null;
      };
      const b = texto('balanza');
      const c = texto('client');
      const p = texto('proveedor');
      const i = texto('inventario');
      if (b === null && c === null && p === null && i === null) {
        setAviso('❌ El archivo no trae hojas Balanza/Clientes/Proveedores/Inventario — ¿es la plantilla?');
        return;
      }
      if (b !== null) setTxtBalanza(b);
      if (c !== null) setTxtClientes(c);
      if (p !== null) setTxtProveedores(p);
      if (i !== null) setTxtInventario(i);
      setResultado(null);
      setAviso('✅ Plantilla cargada en los 4 bloques — revisá y validá');
    } catch {
      setAviso('❌ No se pudo leer el archivo');
    }
  }

  async function validar() {
    setAviso('');
    setOcupado(true);
    try {
      setResultado(await api.post<Resultado>('/apertura/validar', paquete));
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error validando'}`);
    } finally {
      setOcupado(false);
    }
  }

  async function cargar() {
    if (!confirm('¿Cargar la apertura? Se crea el asiento de saldos iniciales con todos sus auxiliares.')) return;
    setAviso('');
    setOcupado(true);
    try {
      const r = await api.post<{ asiento_id: number }>('/apertura/cargar', paquete);
      setAviso(`✅ Apertura cargada — asiento #${r.asiento_id}`);
      setResultado(null);
      try {
        for (const k of ['fecha', 'balanza', 'clientes', 'proveedores', 'inventario']) {
          localStorage.removeItem(`${RECUERDO}:${k}`);
        }
      } catch { /* sin respaldo que limpiar */ }
      await cargarEstado();
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al cargar'}`);
    } finally {
      setOcupado(false);
    }
  }

  async function anular() {
    const motivo = prompt('Motivo de la anulación (queda en bitácora):');
    if (!motivo) return;
    if (!confirm('Se crea el contra-asiento y se revierten cartera, proveedores e inventario. ¿Continuar?')) return;
    setAviso('');
    setOcupado(true);
    try {
      await api.post('/apertura/anular', { motivo });
      setAviso('✅ Apertura anulada (contra-asiento + reversas)');
      await cargarEstado();
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al anular'}`);
    } finally {
      setOcupado(false);
    }
  }

  async function limpiar() {
    if (!confirm('Se BORRAN todas las transacciones (asientos, facturas, recibos, compras, bancos, pólizas, traslados, kardex). Catálogos, usuarios y bitácora se conservan. ¿Continuar?')) return;
    setAviso('');
    setOcupado(true);
    try {
      await api.post('/apertura/limpiar', { confirmacion: fraseLimpiar, incluir_catalogo: incluirCatalogo });
      setAviso('✅ Datos de prueba eliminados — el sistema quedó listo para la carga real');
      setFraseLimpiar('');
      setResultado(null);
      await cargarEstado();
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al limpiar'}`);
    } finally {
      setOcupado(false);
    }
  }

  const n = (v: unknown) => Number(v ?? 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = estado?.datos_actuales;
  const fraseOkBool = fraseLimpiar.trim().replace(/\s+/g, ' ').toUpperCase() === 'LIMPIAR PRUEBAS';

  return (
    <div className="max-w-5xl space-y-4">
      {aviso && <p className="text-sm whitespace-pre-line">{aviso}</p>}

      {/* ----- estado actual ----- */}
      {estado?.cargada && estado.apertura && (
        <div className="tarjeta p-6 border-l-4 border-verde">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-semibold mb-1">✅ Apertura cargada — asiento #{estado.apertura.id}</div>
              <div className="text-sm text-slate-500">
                {estado.apertura.concepto} · total <span className="cifra">C$ {n(estado.apertura.total)}</span>
              </div>
              {estado.auxiliares && (
                <div className="text-sm text-slate-500 mt-1">
                  Auxiliares: {estado.auxiliares.clientes} clientes · {estado.auxiliares.proveedores} proveedores · {estado.auxiliares.inventario} entradas de inventario
                </div>
              )}
            </div>
            <button onClick={() => void anular()} disabled={ocupado} className="boton-peligro shrink-0">Anular apertura</button>
          </div>
        </div>
      )}

      {/* ----- formulario de carga ----- */}
      {!estado?.cargada && (
        <div className="tarjeta p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
              Carga de saldos iniciales
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="boton-suave cursor-pointer">
                🪄 Importar balanza del sistema viejo
                <input type="file" accept=".xls,.xlsx" className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importarBalanzaVieja(f);
                    e.target.value = '';
                  }} />
              </label>
              <button onClick={() => void descargarPlantilla()} disabled={ocupado} className="boton-suave">
                ⬇ Descargar plantilla Excel
              </button>
              <label className="boton-primario cursor-pointer">
                ⬆ Subir plantilla llena
                <input type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void subirPlantilla(f);
                    e.target.value = '';
                  }} />
              </label>
            </div>
          </div>
          <p className="text-sm text-slate-500 -mt-2 mb-4">
            La plantilla ya trae tu catálogo (cuentas, clientes, proveedores y productos): solo llenás los
            montos y la subís. También podés subir cada hoja por separado o pegar las columnas desde Excel.
          </p>
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="etiqueta">Fecha de corte</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="entrada" />
            </div>
            <label className="flex items-end gap-2 text-sm text-slate-600 pb-2 md:col-span-2">
              <input type="checkbox" checked={crearTerceros} onChange={(e) => setCrearTerceros(e.target.checked)} />
              Crear clientes/proveedores que no existan en el catálogo
            </label>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-end justify-between gap-2">
                <label className="etiqueta">1 · Balanza (obligatoria) — <span className="cifra">cuenta&nbsp;·&nbsp;débito&nbsp;·&nbsp;crédito</span></label>
                <BotonArchivo alLeer={setTxtBalanza} />
              </div>
              <textarea value={txtBalanza} onChange={(e) => setTxtBalanza(e.target.value)} rows={9}
                placeholder={'1-01-01\t50000.00\t\n1-01-03\t120000.00\t\n2-01\t\t80000.00\n3-01\t\t90000.00'}
                className="entrada cifra text-[12px] leading-5" />
              <p className="text-xs text-slate-400 mt-1">Solo cuentas de detalle. Débitos = créditos al centavo (igual que la balanza del sistema viejo).</p>
            </div>
            <div>
              <div className="flex items-end justify-between gap-2">
                <label className="etiqueta">2 · Cartera de clientes — <span className="cifra">ruc&nbsp;·&nbsp;nombre&nbsp;·&nbsp;saldo</span></label>
                <BotonArchivo alLeer={setTxtClientes} />
              </div>
              <textarea value={txtClientes} onChange={(e) => setTxtClientes(e.target.value)} rows={9}
                placeholder={'J0310001\tJuan Pérez\t100000.00\nJ0310002\tFerretería El Clavo\t54300.50'}
                className="entrada cifra text-[12px] leading-5" />
              <p className="text-xs text-slate-400 mt-1">Un saldo global por cliente (se cobra hasta llegar a cero). La suma debe ser IGUAL a la cuenta CxC de la balanza. Sin RUC: <span className="cifra">nombre·saldo</span>.</p>
            </div>
            <div>
              <div className="flex items-end justify-between gap-2">
                <label className="etiqueta">3 · Saldos a proveedores — <span className="cifra">ruc&nbsp;·&nbsp;nombre&nbsp;·&nbsp;saldo</span></label>
                <BotonArchivo alLeer={setTxtProveedores} />
              </div>
              <textarea value={txtProveedores} onChange={(e) => setTxtProveedores(e.target.value)} rows={7}
                placeholder={'J0450001\tDistribuidora Norte\t80000.00'}
                className="entrada cifra text-[12px] leading-5" />
              <p className="text-xs text-slate-400 mt-1">La suma debe ser IGUAL a la cuenta CxP. Quedan pagables desde Bancos.</p>
            </div>
            <div>
              <div className="flex items-end justify-between gap-2">
                <label className="etiqueta">4 · Inventario — <span className="cifra">código&nbsp;·&nbsp;bodega&nbsp;·&nbsp;cantidad&nbsp;·&nbsp;costo</span></label>
                <BotonArchivo alLeer={setTxtInventario} />
              </div>
              <textarea value={txtInventario} onChange={(e) => setTxtInventario(e.target.value)} rows={7}
                placeholder={'PR-100\tBOD-CEN\t50\t230.50'}
                className="entrada cifra text-[12px] leading-5" />
              <p className="text-xs text-slate-400 mt-1">Los productos deben existir en el catálogo. Cantidad × costo debe sumar IGUAL a la cuenta Inventario.</p>
              <label className="text-xs font-semibold text-verde cursor-pointer hover:underline inline-block mt-1">
                📦 importar reporte de existencias del sistema viejo
                <input type="file" accept=".xls,.xlsx" className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void leerReporteExistencias(f);
                    e.target.value = '';
                  }} />
              </label>
            </div>
          </div>

          {reporteExi && (
            <div className="mt-5 rounded-xl border border-borde p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400 mb-2">
                {reporteExi.formato === 'largo'
                  ? 'Mapeo de bodegas del sistema viejo → bodegas del sistema'
                  : 'Mapeo de columnas del reporte → bodegas del sistema'}
              </div>
              <p className="text-sm text-slate-500 mb-3">
                {reporteExi.formato === 'largo'
                  ? 'Cada número es un código de bodega del sistema viejo (columna CODIGO_BODEGA). Elegí a qué bodega nueva va cada uno (varios pueden caer en la misma — se suman). Los que dejés en blanco se ignoran.'
                  : 'Cada columna del reporte es una ubicación del sistema viejo. Elegí a qué bodega nueva va cada una (varias columnas pueden caer en la misma bodega — se suman). Las que dejés en blanco se ignoran.'}
              </p>
              {bodegas.length === 0 && (
                <p className="text-sm text-rojo mb-3">No hay bodegas activas: crealas primero en Configuración → Bodegas.</p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {reporteExi.candidatas.map((col) => (
                  <div key={col}>
                    <label className="etiqueta cifra">{col}</label>
                    <select value={mapeo[col] ?? ''} onChange={(e) => setMapeo({ ...mapeo, [col]: e.target.value })} className="entrada">
                      <option value="">— ignorar —</option>
                      {bodegas.map((b) => <option key={b.codigo} value={b.codigo}>{b.codigo} · {b.nombre}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="etiqueta">
                    {reporteExi.formato === 'largo' && !reporteExi.encabezado.some((c) => c.toLowerCase() === 'costo')
                      ? 'Tipo de cambio (OBLIGATORIO: costos en US$)'
                      : 'Tipo de cambio (para el precio de venta en US$, opcional)'}
                  </label>
                  <input value={tipoCambio} onChange={(e) => setTipoCambio(e.target.value)} placeholder="36.80" className="entrada cifra max-w-40" />
                </div>
                <button onClick={() => void convertirExistencias()} disabled={ocupado} className="boton-primario">
                  Convertir existencias
                </button>
                <button onClick={() => setReporteExi(null)} className="boton-suave">Cancelar</button>
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-5">
            <button onClick={() => void validar()} disabled={ocupado || !fecha} className="boton-suave">Validar sin grabar</button>
            <button onClick={() => void cargar()} disabled={ocupado || !resultado?.valida} className="boton-primario">
              Cargar apertura
            </button>
            {!resultado?.valida && <span className="text-sm text-slate-400 self-center">primero validá en limpio</span>}
          </div>

          {/* resultado de la validación */}
          {resultado && (
            <div className={`mt-5 rounded-xl border p-4 ${resultado.valida ? 'border-verde/40 bg-verde/5' : 'border-rojo/40 bg-rojo/5'}`}>
              <div className="font-semibold mb-2">
                {resultado.valida ? '✅ Validación en limpio: lista para cargar' : `❌ ${resultado.errores.length} problema(s) — no se ha grabado nada`}
              </div>
              {resultado.errores.length > 0 && (
                <ul className="text-sm text-rojo space-y-1 mb-2">
                  {resultado.errores.map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              )}
              {resultado.avisos.length > 0 && (
                <ul className="text-sm text-ambar space-y-1 mb-2">
                  {resultado.avisos.map((a, i) => <li key={i}>⚠ {a}</li>)}
                </ul>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mt-3">
                <div><div className="text-slate-400 text-xs">Débitos = Créditos</div>
                  <div className="cifra">{n(resultado.totales.debitos)} / {n(resultado.totales.creditos)}</div></div>
                <div><div className="text-slate-400 text-xs">Cartera vs CxC</div>
                  <div className="cifra">{n(resultado.totales.cartera)} / {n(resultado.totales.saldo_cxc)}</div></div>
                <div><div className="text-slate-400 text-xs">Proveedores vs CxP</div>
                  <div className="cifra">{n(resultado.totales.proveedores)} / {n(resultado.totales.saldo_cxp)}</div></div>
                <div><div className="text-slate-400 text-xs">Inventario vs cuenta</div>
                  <div className="cifra">{n(resultado.totales.inventario)} / {n(resultado.totales.saldo_inventario)}</div></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ----- zona de peligro: limpiar pruebas ----- */}
      <div className="tarjeta p-6 border-l-4 border-rojo">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-rojo mb-2">Zona de peligro — limpiar datos de prueba</div>
        {d && (
          <p className="text-sm text-slate-500 mb-3">
            Hoy hay <span className="cifra">{d.asientos}</span> asientos, <span className="cifra">{d.facturas}</span> facturas,{' '}
            <span className="cifra">{d.recibos}</span> recibos, <span className="cifra">{d.compras}</span> compras,{' '}
            <span className="cifra">{d.movimientos_banco}</span> mov. bancarios, <span className="cifra">{d.polizas}</span> pólizas,{' '}
            <span className="cifra">{d.traslados}</span> traslados y <span className="cifra">{d.kardex}</span> movimientos de kardex.
          </p>
        )}
        <p className="text-sm text-slate-500 mb-3">
          Borra TODAS las transacciones y reinicia consecutivos, promedios y períodos. Los catálogos
          (cuentas, clientes, proveedores, productos, series, sucursales), los usuarios y la bitácora
          se conservan. Pensado para pasar de las pruebas a la carga real. La operación queda en bitácora.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="etiqueta">Escribí: LIMPIAR PRUEBAS</label>
            <input value={fraseLimpiar} onChange={(e) => setFraseLimpiar(e.target.value)} className="entrada cifra" placeholder="LIMPIAR PRUEBAS" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 pb-2">
            <input type="checkbox" checked={incluirCatalogo} onChange={(e) => setIncluirCatalogo(e.target.checked)} />
            Borrar también clientes, proveedores y productos de prueba
          </label>
          <button onClick={() => void limpiar()} disabled={ocupado || !fraseOkBool} className="boton-peligro">
            Limpiar datos de prueba
          </button>
        </div>
        {!fraseOkBool && fraseLimpiar !== '' && (
          <p className="text-xs text-ambar mt-2">Escribí la frase LIMPIAR PRUEBAS para habilitar el botón.</p>
        )}
        {aviso && <p className="text-sm mt-3">{aviso}</p>}
      </div>
    </div>
  );
}
