import { useEffect, useMemo, useState } from 'react';
import { api, ErrorApi } from '../api';
import type { Bodega, CalculoPoliza, Cliente, Cuenta, OrdenCompra, Poliza, Producto } from '../tipos';
import { montoSiempre } from '../formato';

export default function Polizas() {
  const [vista, setVista] = useState<{ modo: 'lista' } | { modo: 'editor'; id: number | null }>({ modo: 'lista' });
  return vista.modo === 'lista' ? (
    <Lista alAbrir={(id) => setVista({ modo: 'editor', id })} />
  ) : (
    <Editor id={vista.id} alVolver={() => setVista({ modo: 'lista' })} />
  );
}

function Insignia({ estado }: { estado: Poliza['estado'] }) {
  if (estado === 'liquidada') return <span className="insignia-verde">● liquidada</span>;
  if (estado === 'borrador') return <span className="insignia-ambar">◐ borrador</span>;
  return <span className="insignia-roja">✕ anulada</span>;
}

function Lista({ alAbrir }: { alAbrir: (id: number | null) => void }) {
  const [polizas, setPolizas] = useState<Poliza[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<Poliza[]>('/polizas').then(setPolizas).catch((e) => setError(e instanceof ErrorApi ? e.message : 'Error'));
  }, []);
  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => alAbrir(null)} className="boton-primario">+ Nueva póliza</button>
      </div>
      {error && <p className="text-sm text-rojo mb-3">{error}</p>}
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr><th>Nº póliza</th><th>Fecha</th><th>Proveedor</th><th>Bodega</th>
            <th className="text-right">Productos</th><th className="text-right">Costo inventario C$</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {polizas.length === 0 && (
              <tr><td colSpan={7} className="py-14 text-center text-slate-400">Sin pólizas — registrá la primera importación</td></tr>
            )}
            {polizas.map((p) => (
              <tr key={p.id} onClick={() => alAbrir(p.id)} className="cursor-pointer">
                <td className="cifra font-medium">{p.numero}</td>
                <td>{p.fecha.slice(0, 10)}</td>
                <td className="font-medium">{p.proveedor ?? '—'}</td>
                <td className="text-slate-500">{p.bodega_nombre}</td>
                <td className="text-right cifra">{p.productos ?? 0}</td>
                <td className="text-right cifra font-medium">{montoSiempre(p.total_inventario)}</td>
                <td><Insignia estado={p.estado} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface LineaF { productoId: string; cantidad: string; fob: string; peso: string; terceroId: string }
interface GastoF { concepto: string; monto: string; base: 'valor' | 'peso' | 'unidades'; es_iva: boolean; cuenta: string }

const LINEA0: LineaF = { productoId: '', cantidad: '1', fob: '', peso: '0', terceroId: '' };
const GASTOS_SUGERIDOS = ['Flete', 'Seguro', 'DAI', 'ISC', 'Agencia aduanera', 'Transporte interno'];

function Editor({ id, alVolver }: { id: number | null; alVolver: () => void }) {
  const [poliza, setPoliza] = useState<Poliza | null>(null);
  const [proveedores, setProveedores] = useState<Cliente[]>([]);
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const [numero, setNumero] = useState('');
  const [terceroId, setTerceroId] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [bodega, setBodega] = useState('');
  const [moneda, setMoneda] = useState<'NIO' | 'USD'>('USD');
  const [tc, setTc] = useState('36.60');
  const [notas, setNotas] = useState('');
  const [lineas, setLineas] = useState<LineaF[]>([{ ...LINEA0 }]);
  const [gastos, setGastos] = useState<GastoF[]>([]);
  const [calc, setCalc] = useState<CalculoPoliza | null>(null);
  const [ordenesIds, setOrdenesIds] = useState<number[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [mostrarOC, setMostrarOC] = useState(false);

  const soloLectura = poliza !== null && poliza.estado !== 'borrador';

  useEffect(() => {
    Promise.all([
      api.get<Cliente[]>('/proveedores'),
      api.get<Bodega[]>('/configuracion/bodegas'),
      api.get<Producto[]>('/productos'),
      api.get<Cuenta[]>('/cuentas'),
      api.get<OrdenCompra[]>('/ordenes'),
    ]).then(([pr, b, p, c, oc]) => {
      setProveedores(pr.filter((x) => x.activo));
      setBodegas(b.filter((x) => x.activa));
      setProductos(p.filter((x) => x.activo));
      setCuentas(c.filter((x) => x.es_detalle && x.activa));
      // Solo aprobadas y que NO estén ya en otra póliza (borrador o liquidada)
      setOrdenes(oc.filter((x) => x.estado === 'aprobada' && (!x.en_poliza || x.en_poliza === id)));
    }).catch(() => setAviso('❌ Error cargando catálogos'));

    if (id) {
      api.get<Poliza & { gastos: unknown[] }>(`/polizas/${id}`).then((pz) => {
        setPoliza(pz);
        setNumero(pz.numero);
        setTerceroId(pz.tercero_id ? String(pz.tercero_id) : '');
        setFecha(pz.fecha.slice(0, 10));
        setBodega(pz.bodega);
        setMoneda(pz.moneda);
        setTc(String(pz.tipo_cambio));
        setNotas(pz.notas ?? '');
        setOrdenesIds((pz as unknown as { ordenes_ids?: number[] }).ordenes_ids ?? []);
        setLineas((pz.lineas ?? []).map((l) => ({
          productoId: String(l.producto_id), cantidad: String(l.cantidad),
          fob: String(l.fob_unitario), peso: String(l.peso),
          terceroId: (l as { tercero_id?: number | null }).tercero_id ? String((l as { tercero_id?: number | null }).tercero_id) : '',
        })));
        setGastos(((pz as unknown as { gastos: Array<{ concepto: string; monto: number; base: string; es_iva: boolean; cuenta_contable: string }> }).gastos ?? []).map((g) => ({
          concepto: g.concepto, monto: String(g.monto), base: g.base as GastoF['base'], es_iva: g.es_iva, cuenta: g.cuenta_contable,
        })));
      }).catch((e) => setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error'}`));
    }
  }, [id]);

  const cuerpo = useMemo(() => ({
    numero, tercero_id: terceroId ? Number(terceroId) : null, fecha, bodega, moneda,
    tipo_cambio: Number(tc) || 1, notas,
    ordenes_ids: ordenesIds,
    lineas: lineas.filter((l) => l.productoId && Number(l.cantidad) > 0).map((l) => ({
      producto_id: Number(l.productoId), cantidad: Number(l.cantidad),
      fob_unitario: Number(l.fob || 0), peso: Number(l.peso || 0),
      tercero_id: l.terceroId ? Number(l.terceroId) : null,
    })),
    gastos: gastos.filter((g) => g.concepto && g.cuenta).map((g) => ({
      concepto: g.concepto, monto: Number(g.monto || 0), base: g.base, es_iva: g.es_iva, cuenta_contable: g.cuenta,
    })),
  }), [numero, terceroId, fecha, bodega, moneda, tc, notas, lineas, gastos, ordenesIds]);

  async function jalarOC(oc: OrdenCompra) {
    setMostrarOC(false);
    if (ordenesIds.includes(oc.id)) {
      setAviso(`❌ La OC-${String(oc.id).padStart(4, '0')} ya fue jalada a esta póliza`);
      return;
    }
    try {
      const completa = await api.get<OrdenCompra>(`/ordenes/${oc.id}`);
      const nuevas: LineaF[] = (completa.lineas ?? [])
        .filter((l) => l.producto_id)
        .map((l) => ({
          productoId: String(l.producto_id), cantidad: String(l.cantidad),
          fob: String(l.costo_unitario), peso: '0', terceroId: String(completa.tercero_id),
        }));
      if (nuevas.length === 0) { setAviso('❌ Esa orden no tiene productos de catálogo'); return; }
      setLineas((prev) => {
        const base = prev.filter((l) => l.productoId);  // descarta la línea vacía inicial
        return [...base, ...nuevas];
      });
      setOrdenesIds((prev) => (prev.includes(oc.id) ? prev : [...prev, oc.id]));
      if (!terceroId) setTerceroId(String(completa.tercero_id));
      setAviso(`✅ Se jalaron ${nuevas.length} producto(s) de la OC-${String(oc.id).padStart(4, '0')} (${completa.proveedor})`);
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al jalar la orden'}`);
    }
  }

  // Prorrateo en vivo (mismo cálculo que la liquidación)
  useEffect(() => {
    if (cuerpo.lineas.length === 0) { setCalc(null); return; }
    const t = setTimeout(() => {
      api.post<CalculoPoliza>('/polizas/calcular', { lineas: cuerpo.lineas, gastos: cuerpo.gastos, tipo_cambio: cuerpo.tipo_cambio })
        .then(setCalc).catch(() => setCalc(null));
    }, 250);
    return () => clearTimeout(t);
  }, [cuerpo]);

  const valida = numero !== '' && bodega !== '' && cuerpo.lineas.length > 0 &&
    gastos.every((g) => !g.concepto || g.cuenta !== '');

  async function guardar(): Promise<number | null> {
    setOcupado(true); setAviso('');
    try {
      const r = poliza ? await api.put<{ id: number }>(`/polizas/${poliza.id}`, cuerpo) : await api.post<{ id: number }>('/polizas', cuerpo);
      if (!poliza) setPoliza({ id: r.id, estado: 'borrador' } as Poliza);
      setAviso('✅ Borrador guardado');
      return r.id;
    } catch (e) { setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al guardar'}`); return null; }
    finally { setOcupado(false); }
  }

  async function liquidar() {
    if (!confirm('¿Liquidar la póliza? Meterá los productos al inventario a su costo puesto en bodega y generará el asiento de nacionalización. Después solo se puede anular.')) return;
    const pid = await guardar();
    if (!pid) return;
    setOcupado(true);
    try {
      const liq = await api.post<Poliza>(`/polizas/${pid}/liquidar`);
      setPoliza(liq);
      setAviso(`✅ Póliza ${liq.numero} liquidada — inventario y costo promedio actualizados`);
    } catch (e) { setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al liquidar'}`); }
    finally { setOcupado(false); }
  }

  async function anular() {
    if (!poliza) return;
    const motivo = prompt(`Motivo para anular la póliza ${poliza.numero}:`);
    if (!motivo) return;
    setOcupado(true);
    try {
      const a = await api.post<Poliza>(`/polizas/${poliza.id}/anular`, { motivo });
      setPoliza(a);
      setAviso('✅ Póliza anulada — inventario revertido con contra-asiento');
    } catch (e) { setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al anular'}`); }
    finally { setOcupado(false); }
  }

  const costoDe = (productoId: string) => calc?.lineas.find((x) => String(x.producto_id) === productoId)?.costo_unitario;

  return (
    <div className="max-w-6xl">
      <button onClick={alVolver} className="text-sm font-semibold text-slate-500 hover:text-tinta mb-4">← Volver al listado</button>

      {poliza && poliza.estado !== 'borrador' && (
        <div className="tarjeta px-6 py-4 mb-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Póliza</div>
            <div className="text-2xl font-extrabold cifra text-tinta">{poliza.numero}</div>
          </div>
          <Insignia estado={poliza.estado} />
          {poliza.estado === 'liquidada' && (
            <button onClick={() => void anular()} disabled={ocupado} className="boton-peligro">Anular póliza</button>
          )}
        </div>
      )}
      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      <div className="tarjeta p-6 mb-4">
        <div className="grid md:grid-cols-4 gap-4">
          <div><label className="etiqueta">Nº de póliza</label>
            <input value={numero} disabled={soloLectura} onChange={(e) => setNumero(e.target.value)} className="entrada cifra" /></div>
          <div className="md:col-span-2"><label className="etiqueta">Proveedor del exterior</label>
            <select value={terceroId} disabled={soloLectura} onChange={(e) => setTerceroId(e.target.value)} className="entrada">
              <option value="">— proveedor —</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select></div>
          <div><label className="etiqueta">Fecha</label>
            <input type="date" value={fecha} disabled={soloLectura} onChange={(e) => setFecha(e.target.value)} className="entrada" /></div>
          <div><label className="etiqueta">Bodega destino</label>
            <select value={bodega} disabled={soloLectura} onChange={(e) => setBodega(e.target.value)} className="entrada">
              <option value="">— bodega —</option>
              {bodegas.map((b) => <option key={b.codigo} value={b.codigo}>{b.codigo} · {b.nombre}</option>)}
            </select></div>
          <div><label className="etiqueta">Moneda FOB</label>
            <select value={moneda} disabled={soloLectura} onChange={(e) => setMoneda(e.target.value as 'NIO' | 'USD')} className="entrada">
              <option value="USD">USD</option><option value="NIO">NIO</option>
            </select></div>
          <div><label className="etiqueta">Tipo de cambio</label>
            <input type="number" step="0.0001" value={tc} disabled={soloLectura || moneda === 'NIO'}
              onChange={(e) => setTc(e.target.value)} className="entrada text-right cifra" /></div>
        </div>
      </div>

      {/* Productos importados */}
      <div className="tarjeta p-6 mb-4">
        <div className="flex items-center justify-between mb-1">
          <label className="etiqueta">Productos importados (FOB en {moneda})</label>
          {!soloLectura && (
            <button type="button" onClick={() => setMostrarOC(true)} className="boton-suave px-3 py-1 text-[13px]">
              ⇩ Jalar orden de compra
            </button>
          )}
        </div>
        {ordenesIds.length > 0 && (
          <p className="text-[11px] text-slate-400 mb-1">Armada de {ordenesIds.length} orden(es) de compra — al liquidar quedan recibidas.</p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 text-left">
              <th className="pb-2">Producto</th><th className="pb-2 w-40">Proveedor</th><th className="pb-2 w-20">Cant.</th>
              <th className="pb-2 w-28">FOB unit.</th><th className="pb-2 w-24">Peso</th>
              <th className="pb-2 w-32 text-right">Costo p/bodega C$</th><th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => {
              const cu = costoDe(l.productoId);
              return (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <select value={l.productoId} disabled={soloLectura}
                      onChange={(e) => setLineas(lineas.map((x, j) => j === i ? { ...x, productoId: e.target.value } : x))} className="entrada">
                      <option value="">— producto —</option>
                      {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <select value={l.terceroId} disabled={soloLectura}
                      onChange={(e) => setLineas(lineas.map((x, j) => j === i ? { ...x, terceroId: e.target.value } : x))} className="entrada">
                      <option value="">— del encabezado —</option>
                      {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2"><input type="number" min="0" step="0.01" value={l.cantidad} disabled={soloLectura}
                    onChange={(e) => setLineas(lineas.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x))} className="entrada text-right" /></td>
                  <td className="py-1 pr-2"><input type="number" min="0" step="0.0001" value={l.fob} disabled={soloLectura} placeholder="0.00"
                    onChange={(e) => setLineas(lineas.map((x, j) => j === i ? { ...x, fob: e.target.value } : x))} className="entrada text-right" /></td>
                  <td className="py-1 pr-2"><input type="number" min="0" step="0.01" value={l.peso} disabled={soloLectura} title="para prorrateo por peso"
                    onChange={(e) => setLineas(lineas.map((x, j) => j === i ? { ...x, peso: e.target.value } : x))} className="entrada text-right" /></td>
                  <td className="py-1 text-right cifra font-semibold text-verde-oscuro">{cu != null ? montoSiempre(cu) : '—'}</td>
                  <td className="text-center">{!soloLectura && lineas.length > 1 && (
                    <button type="button" onClick={() => setLineas(lineas.filter((_, j) => j !== i))} className="text-slate-300 hover:text-rojo">✕</button>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!soloLectura && (
          <button type="button" onClick={() => setLineas([...lineas, { ...LINEA0 }])} className="text-sm font-semibold text-verde hover:text-verde-oscuro mt-1">+ Agregar producto</button>
        )}
      </div>

      {/* Gastos de importación */}
      <div className="tarjeta p-6 mb-4">
        <div className="flex items-center justify-between mb-1">
          <label className="etiqueta">Gastos de importación (en C$)</label>
          {!soloLectura && (
            <div className="flex flex-wrap gap-1">
              {GASTOS_SUGERIDOS.map((c) => (
                <button key={c} type="button" onClick={() => setGastos([...gastos, { concepto: c, monto: '', base: c === 'Flete' ? 'peso' : 'valor', es_iva: false, cuenta: '' }])}
                  className="text-[11px] px-2 py-1 rounded border border-borde text-slate-500 hover:border-verde hover:text-verde">+ {c}</button>
              ))}
            </div>
          )}
        </div>
        {gastos.length === 0 ? (
          <p className="text-sm text-slate-400">Agregá flete, seguro, DAI, agencia… cada uno se prorratea al costo de los productos.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 text-left">
                <th className="pb-2">Concepto</th><th className="pb-2 w-32">Monto C$</th>
                <th className="pb-2 w-32">Prorratea por</th><th className="pb-2 w-24">¿IVA acred.?</th>
                <th className="pb-2">Cuenta contrapartida</th><th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {gastos.map((g, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2"><input value={g.concepto} disabled={soloLectura}
                    onChange={(e) => setGastos(gastos.map((x, j) => j === i ? { ...x, concepto: e.target.value } : x))} className="entrada" /></td>
                  <td className="py-1 pr-2"><input type="number" min="0" step="0.01" value={g.monto} disabled={soloLectura} placeholder="0.00"
                    onChange={(e) => setGastos(gastos.map((x, j) => j === i ? { ...x, monto: e.target.value } : x))} className="entrada text-right" /></td>
                  <td className="py-1 pr-2">
                    <select value={g.base} disabled={soloLectura || g.es_iva}
                      onChange={(e) => setGastos(gastos.map((x, j) => j === i ? { ...x, base: e.target.value as GastoF['base'] } : x))} className="entrada">
                      <option value="valor">Valor (FOB)</option><option value="peso">Peso</option><option value="unidades">Unidades</option>
                    </select>
                  </td>
                  <td className="py-1 pr-2 text-center">
                    <input type="checkbox" checked={g.es_iva} disabled={soloLectura}
                      onChange={(e) => setGastos(gastos.map((x, j) => j === i ? { ...x, es_iva: e.target.checked } : x))} />
                  </td>
                  <td className="py-1 pr-2">
                    <select value={g.cuenta} disabled={soloLectura}
                      onChange={(e) => setGastos(gastos.map((x, j) => j === i ? { ...x, cuenta: e.target.value } : x))} className="entrada">
                      <option value="">— cuenta —</option>
                      {cuentas.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
                    </select>
                  </td>
                  <td className="text-center">{!soloLectura && (
                    <button type="button" onClick={() => setGastos(gastos.filter((_, j) => j !== i))} className="text-slate-300 hover:text-rojo">✕</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          El IVA de importación (marcado "IVA acred.") va a crédito fiscal, no al costo. El resto (flete, DAI, agencia…) se reparte al costo de cada producto según la base elegida.
        </p>
      </div>

      {/* Resumen */}
      <div className="tarjeta p-6 flex items-end justify-between flex-wrap gap-4">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-1 text-sm">
          <dt className="text-slate-500">FOB</dt><dd className="cifra text-right">{montoSiempre(calc?.fob ?? 0)}</dd>
          <dt className="text-slate-500">Gastos al costo</dt><dd className="cifra text-right">{montoSiempre(calc?.gastos ?? 0)}</dd>
          <dt className="text-slate-500">IVA acreditable</dt><dd className="cifra text-right">{montoSiempre(calc?.iva ?? 0)}</dd>
          <dt className="font-bold text-tinta">Costo a inventario</dt>
          <dd className="cifra text-right font-bold text-verde-oscuro">{montoSiempre(calc?.total_inventario ?? 0)}</dd>
        </dl>
        {!soloLectura && (
          <div className="flex gap-2">
            {poliza && <button onClick={() => { if (confirm('¿Descartar este borrador?')) void api.borrar(`/polizas/${poliza.id}`).then(alVolver); }} className="boton-peligro">Descartar</button>}
            <button onClick={() => void guardar()} disabled={!valida || ocupado} className="boton-suave">Guardar borrador</button>
            <button onClick={() => void liquidar()} disabled={!valida || ocupado} className="boton-primario">Liquidar póliza</button>
          </div>
        )}
      </div>

      {mostrarOC && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-tinta/40 p-4 pt-[8vh]" onClick={() => setMostrarOC(false)}>
          <div className="w-full max-w-xl tarjeta p-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-borde flex items-center justify-between">
              <h3 className="font-bold text-tinta">Órdenes de compra aprobadas</h3>
              <button onClick={() => setMostrarOC(false)} className="text-slate-400 hover:text-tinta">✕</button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              <table className="tabla">
                <thead className="sticky top-0"><tr><th>Orden</th><th>Fecha</th><th>Proveedor</th><th className="text-right">Total C$</th><th></th></tr></thead>
                <tbody>
                  {ordenes.filter((o) => !ordenesIds.includes(o.id)).length === 0 && (
                    <tr><td colSpan={5} className="py-10 text-center text-slate-400">
                      No hay órdenes aprobadas disponibles (las ya jaladas no se repiten)
                    </td></tr>
                  )}
                  {ordenes.filter((o) => !ordenesIds.includes(o.id)).map((o) => (
                    <tr key={o.id}>
                      <td className="cifra font-medium">OC-{String(o.id).padStart(4, '0')}</td>
                      <td>{o.fecha.slice(0, 10)}</td>
                      <td className="font-medium">{o.proveedor}</td>
                      <td className="text-right cifra">{montoSiempre(o.total)}</td>
                      <td className="text-right">
                        <button onClick={() => void jalarOC(o)} className="text-sm font-semibold text-verde hover:text-verde-oscuro">Jalar →</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-borde text-[11px] text-slate-400">
              Podés jalar varias órdenes de distintos proveedores — cada producto queda con su proveedor (multipóliza).
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
