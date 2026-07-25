import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ErrorApi } from '../api';
import type { Bodega, Cliente, Compra, OrdenCompra, Producto, RetencionTipo, Sucursal } from '../tipos';
import { montoSiempre } from '../formato';

const PESTANAS = [
  { clave: 'compras', titulo: 'Compras' },
  { clave: 'ordenes', titulo: 'Órdenes de compra' },
  { clave: 'proveedores', titulo: 'Proveedores' },
] as const;

type Pestana = (typeof PESTANAS)[number]['clave'];

interface PrefillCompra {
  orden_compra_id: number;
  tercero_id: number;
  bodega: string;
  lineas: Array<{ productoId: string; cantidad: string; costo: string }>;
}

export default function Compras() {
  const navigate = useNavigate();
  const { pestana: parametro } = useParams();
  const pestana: Pestana = PESTANAS.some((p) => p.clave === parametro) ? (parametro as Pestana) : 'compras';
  const [prefill, setPrefill] = useState<PrefillCompra | null>(null);

  return (
    <div>
      <div className="inline-flex gap-1 bg-white border border-borde rounded-xl p-1 mb-5">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            onClick={() => navigate(`/compras/${p.clave}`)}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition ${
              pestana === p.clave ? 'bg-tinta text-white' : 'text-slate-500 hover:text-tinta'
            }`}
          >
            {p.titulo}
          </button>
        ))}
      </div>

      {pestana === 'compras' && <TabCompras prefill={prefill} limpiarPrefill={() => setPrefill(null)} />}
      {pestana === 'ordenes' && (
        <TabOrdenes
          alConvertir={(p) => {
            setPrefill(p);
            navigate('/compras/compras');
          }}
        />
      )}
      {pestana === 'proveedores' && <TabProveedores />}
    </div>
  );
}

function InsigniaEstado({ estado }: { estado: string }) {
  if (estado === 'registrada' || estado === 'aprobada' || estado === 'recibida')
    return <span className="insignia-verde">● {estado}</span>;
  if (estado === 'borrador') return <span className="insignia-ambar">◐ borrador</span>;
  return <span className="insignia-roja">✕ anulada</span>;
}

/* ----------------------------------------------------------------- compras */

function TabCompras({ prefill, limpiarPrefill }: { prefill: PrefillCompra | null; limpiarPrefill: () => void }) {
  const [vista, setVista] = useState<{ modo: 'lista' } | { modo: 'editor'; id: number | null }>(
    prefill ? { modo: 'editor', id: null } : { modo: 'lista' }
  );

  return vista.modo === 'lista' ? (
    <ListaCompras alAbrir={(id) => setVista({ modo: 'editor', id })} />
  ) : (
    <EditorCompra
      id={vista.id}
      prefill={prefill}
      alVolver={() => {
        limpiarPrefill();
        setVista({ modo: 'lista' });
      }}
    />
  );
}

function ListaCompras({ alAbrir }: { alAbrir: (id: number | null) => void }) {
  const [compras, setCompras] = useState<Compra[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Compra[]>('/compras')
      .then(setCompras)
      .catch((e) => setError(e instanceof ErrorApi ? e.message : 'Error cargando compras'));
  }, []);

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => alAbrir(null)} className="boton-primario">+ Nueva compra</button>
      </div>
      {error && <p className="text-sm text-rojo mb-3">{error}</p>}
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Documento</th><th>Fecha</th><th>Proveedor</th><th>Bodega</th><th>Pago</th>
              <th className="text-right">Total C$</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {compras.length === 0 && (
              <tr><td colSpan={7} className="py-14 text-center text-slate-400">Sin compras — registrá la primera para alimentar el inventario</td></tr>
            )}
            {compras.map((c) => (
              <tr key={c.id} onClick={() => alAbrir(c.id)} className="cursor-pointer">
                <td className="cifra font-medium">{c.numero_documento}</td>
                <td>{c.fecha.slice(0, 10)}</td>
                <td className="font-medium">{c.proveedor}</td>
                <td className="text-slate-500">{c.bodega_nombre}</td>
                <td className="text-slate-500 capitalize">{c.tipo_pago}</td>
                <td className="text-right cifra font-medium">{montoSiempre(c.total)}</td>
                <td><InsigniaEstado estado={c.estado} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface LineaFormCompra {
  productoId: string;
  cantidad: string;
  costo: string;
}

const LINEA_COMPRA: LineaFormCompra = { productoId: '', cantidad: '1', costo: '' };

function EditorCompra({ id, prefill, alVolver }: { id: number | null; prefill: PrefillCompra | null; alVolver: () => void }) {
  const [compra, setCompra] = useState<Compra | null>(null);
  const [proveedores, setProveedores] = useState<Cliente[]>([]);
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [tiposRet, setTiposRet] = useState<RetencionTipo[]>([]);
  const [retenciones, setRetenciones] = useState<string[]>([]);
  const [cajas, setCajas] = useState<Array<{ codigo: string; nombre: string }>>([]);
  const [cuentaPago, setCuentaPago] = useState('');
  const [tasaIva, setTasaIva] = useState(0.15);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const [terceroId, setTerceroId] = useState(prefill ? String(prefill.tercero_id) : '');
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [tipoPago, setTipoPago] = useState<'contado' | 'credito'>('credito');
  const [bodega, setBodega] = useState(prefill?.bodega ?? '');
  const [notas, setNotas] = useState('');
  const [lineas, setLineas] = useState<LineaFormCompra[]>(
    prefill?.lineas.length ? prefill.lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, costo: l.costo })) : [{ ...LINEA_COMPRA }]
  );

  const soloLectura = compra !== null && compra.estado !== 'borrador';

  useEffect(() => {
    Promise.all([
      api.get<Cliente[]>('/proveedores'),
      api.get<Bodega[]>('/configuracion/bodegas'),
      api.get<Producto[]>('/productos'),
      api.get<Array<{ clave: string; valor: string }>>('/config'),
      api.get<RetencionTipo[]>('/retenciones/tipos'),
      api.get<Sucursal[]>('/configuracion/sucursales'),
    ])
      .then(([pr, b, p, cfg, rt, sucs]) => {
        setProveedores(pr.filter((x) => x.activo));
        setBodegas(b.filter((x) => x.activa));
        setProductos(p.filter((x) => x.activo));
        setTiposRet(rt.filter((x) => x.activo && x.aplica === 'compra'));
        const tasa = cfg.find((x) => x.clave === 'tasa_iva');
        if (tasa) setTasaIva(Number(tasa.valor));
        // Cajas disponibles para el pago de contado: general + las de cada sucursal
        const general = cfg.find((x) => x.clave === 'cuenta_caja')?.valor;
        const lista: Array<{ codigo: string; nombre: string }> = [];
        if (general) lista.push({ codigo: general, nombre: 'Caja general' });
        for (const s of sucs) {
          if (s.cuenta_caja && !lista.some((c) => c.codigo === s.cuenta_caja)) {
            lista.push({ codigo: s.cuenta_caja, nombre: `Caja ${s.nombre}` });
          }
        }
        setCajas(lista);
      })
      .catch(() => setAviso('❌ Error cargando catálogos'));

    if (id) {
      api
        .get<Compra>(`/compras/${id}`)
        .then((c) => {
          setCompra(c);
          setTerceroId(String(c.tercero_id));
          setNumeroDocumento(c.numero_documento);
          setFecha(c.fecha.slice(0, 10));
          setTipoPago(c.tipo_pago);
          setBodega(c.bodega);
          setNotas(c.notas ?? '');
          setRetenciones(c.retenciones_codigos ?? []);
          setCuentaPago(c.cuenta_pago ?? '');
          setLineas(
            (c.lineas ?? []).map((l) => ({
              productoId: String(l.producto_id),
              cantidad: String(l.cantidad),
              costo: String(l.costo_unitario),
            }))
          );
        })
        .catch((e) => setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error cargando compra'}`));
    }
  }, [id]);

  const totales = useMemo(() => {
    let subtotalCent = 0;
    for (const l of lineas) {
      const cantidad = Number(l.cantidad || 0);
      const costoCent = Math.round(Number(l.costo || 0) * 100);
      if (cantidad > 0 && costoCent >= 0) subtotalCent += Math.round(cantidad * costoCent);
    }
    const ivaCent = Math.round(subtotalCent * tasaIva);
    return { subtotal: subtotalCent / 100, iva: ivaCent / 100, total: (subtotalCent + ivaCent) / 100 };
  }, [lineas, tasaIva]);

  const valida =
    terceroId !== '' && numeroDocumento !== '' && bodega !== '' &&
    lineas.some((l) => l.productoId && Number(l.cantidad) > 0 && Number(l.costo) > 0);

  // Retención estimada (el cálculo definitivo lo hace el backend al registrar)
  const retencion = useMemo(() => {
    let cent = 0;
    for (const codigo of retenciones) {
      const t = tiposRet.find((x) => x.codigo === codigo);
      if (!t) continue;
      const base = t.base === 'iva' ? totales.iva : t.base === 'total' ? totales.total : totales.subtotal;
      cent += Math.round(base * Number(t.tasa) * 100);
    }
    return cent / 100;
  }, [retenciones, tiposRet, totales]);
  const netoAPagar = Math.round((totales.total - retencion) * 100) / 100;

  function cuerpo() {
    return {
      orden_compra_id: prefill?.orden_compra_id ?? compra?.orden_compra_id ?? null,
      tercero_id: Number(terceroId),
      numero_documento: numeroDocumento,
      fecha,
      tipo_pago: tipoPago,
      bodega,
      notas,
      retenciones_codigos: retenciones,
      cuenta_pago: tipoPago === 'contado' ? (cuentaPago || null) : null,
      lineas: lineas
        .filter((l) => l.productoId)
        .map((l) => ({
          producto_id: Number(l.productoId),
          cantidad: Number(l.cantidad),
          costo_unitario: Number(l.costo),
        })),
    };
  }

  async function guardarBorrador(): Promise<Compra | null> {
    setOcupado(true);
    setAviso('');
    try {
      const guardada = compra
        ? await api.put<Compra>(`/compras/${compra.id}`, cuerpo())
        : await api.post<Compra>('/compras', cuerpo());
      setCompra(guardada);
      setAviso('✅ Borrador guardado');
      return guardada;
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al guardar'}`);
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function registrar() {
    if (!confirm('¿Registrar la compra? Generará su asiento y las entradas al inventario. Después solo puede anularse.')) return;
    const guardada = await guardarBorrador();
    if (!guardada) return;
    setOcupado(true);
    try {
      const registrada = await api.post<Compra>(`/compras/${guardada.id}/registrar`);
      setCompra(registrada);
      setAviso(`✅ Compra ${registrada.numero_documento} registrada — inventario y costo promedio actualizados`);
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al registrar'}`);
    } finally {
      setOcupado(false);
    }
  }

  async function anular() {
    if (!compra) return;
    const motivo = prompt(`Motivo para anular la compra ${compra.numero_documento}:`);
    if (!motivo) return;
    setOcupado(true);
    try {
      const anulada = await api.post<Compra>(`/compras/${compra.id}/anular`, { motivo });
      setCompra(anulada);
      setAviso('✅ Compra anulada — inventario revertido con contra-asiento');
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al anular'}`);
    } finally {
      setOcupado(false);
    }
  }

  async function descartar() {
    if (!compra) {
      alVolver();
      return;
    }
    if (!confirm('¿Descartar este borrador?')) return;
    try {
      await api.borrar(`/compras/${compra.id}`);
      alVolver();
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al descartar'}`);
    }
  }

  return (
    <div className="max-w-5xl">
      <button onClick={alVolver} className="text-sm font-semibold text-slate-500 hover:text-tinta mb-4">
        ← Volver al listado
      </button>

      {compra && compra.estado !== 'borrador' && (
        <div className="tarjeta px-6 py-4 mb-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Compra</div>
            <div className="text-2xl font-extrabold cifra text-tinta">{compra.numero_documento}</div>
          </div>
          <InsigniaEstado estado={compra.estado} />
          {compra.estado === 'registrada' && (
            <button onClick={() => void anular()} disabled={ocupado} className="boton-peligro">Anular compra</button>
          )}
        </div>
      )}

      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      <div className="grid lg:grid-cols-[1fr_290px] gap-4 items-start">
        <div className="tarjeta p-6">
          <div className="grid md:grid-cols-2 gap-4 mb-5">
            <div>
              <label className="etiqueta">Proveedor</label>
              <select value={terceroId} onChange={(e) => setTerceroId(e.target.value)} disabled={soloLectura} className="entrada">
                <option value="">— elegir proveedor —</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="etiqueta">Nº factura proveedor</label>
                <input value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)}
                  disabled={soloLectura} placeholder="0001234" className="entrada cifra" />
              </div>
              <div>
                <label className="etiqueta">Fecha</label>
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={soloLectura} className="entrada" />
              </div>
            </div>
            <div>
              <label className="etiqueta">Bodega destino</label>
              <select value={bodega} onChange={(e) => setBodega(e.target.value)} disabled={soloLectura} className="entrada">
                <option value="">— bodega —</option>
                {bodegas.map((b) => <option key={b.codigo} value={b.codigo}>{b.codigo} · {b.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="etiqueta">Forma de pago</label>
              <div className="inline-flex rounded-lg border border-borde bg-fondo p-1">
                {(['credito', 'contado'] as const).map((t) => (
                  <button key={t} type="button" disabled={soloLectura} onClick={() => setTipoPago(t)}
                    className={`px-4 py-1.5 rounded-md text-sm font-semibold capitalize transition ${
                      tipoPago === t ? 'bg-white text-tinta shadow-sm border border-borde' : 'text-slate-500'
                    }`}>
                    {t === 'credito' ? 'Crédito (CxP)' : 'Contado'}
                  </button>
                ))}
              </div>
            </div>
            {tipoPago === 'contado' && (
              <div>
                <label className="etiqueta">Pagado desde</label>
                <select value={cuentaPago} onChange={(e) => setCuentaPago(e.target.value)}
                  disabled={soloLectura} className="entrada">
                  <option value="">Caja general</option>
                  {cajas.filter((c) => c.nombre !== 'Caja general').map((c) => (
                    <option key={c.codigo} value={c.codigo}>{c.nombre} · {c.codigo}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  ¿Se pagó con cheque o transferencia? Registrala al crédito y pagala desde Bancos
                  (así la conciliación cuadra).
                </p>
              </div>
            )}
          </div>

          <label className="etiqueta">Detalle (productos a inventario)</label>
          <table className="w-full text-sm mb-2">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 text-left">
                <th className="pb-2">Producto</th>
                <th className="pb-2 w-24">Cant.</th>
                <th className="pb-2 w-32">Costo unit.</th>
                <th className="pb-2 w-28 text-right">Importe</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => {
                const importe = Math.round(Number(l.cantidad || 0) * Math.round(Number(l.costo || 0) * 100)) / 100;
                return (
                  <tr key={i}>
                    <td className="py-1 pr-2">
                      <select value={l.productoId} disabled={soloLectura}
                        onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, productoId: e.target.value } : x)))}
                        className="entrada">
                        <option value="">— producto —</option>
                        {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <input type="number" min="0" step="0.01" value={l.cantidad} disabled={soloLectura}
                        onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))}
                        className="entrada text-right" />
                    </td>
                    <td className="py-1 pr-2">
                      <input type="number" min="0" step="0.01" value={l.costo} disabled={soloLectura} placeholder="0.00"
                        onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, costo: e.target.value } : x)))}
                        className="entrada text-right" />
                    </td>
                    <td className="py-1 text-right cifra text-slate-600">{montoSiempre(importe)}</td>
                    <td className="text-center">
                      {!soloLectura && lineas.length > 1 && (
                        <button type="button" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}
                          className="text-slate-300 hover:text-rojo transition-colors" title="Quitar línea">✕</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!soloLectura && (
            <button type="button" onClick={() => setLineas([...lineas, { ...LINEA_COMPRA }])}
              className="text-sm font-semibold text-verde hover:text-verde-oscuro">+ Agregar línea</button>
          )}

          {tiposRet.length > 0 && (
            <div className="mt-5">
              <label className="etiqueta">Retenciones a efectuar al proveedor</label>
              <div className="flex flex-wrap gap-2">
                {tiposRet.map((t) => {
                  const activa = retenciones.includes(t.codigo);
                  return (
                    <button
                      key={t.codigo}
                      type="button"
                      disabled={soloLectura}
                      onClick={() =>
                        setRetenciones(activa ? retenciones.filter((c) => c !== t.codigo) : [...retenciones, t.codigo])
                      }
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition ${
                        activa ? 'bg-verde text-white border-verde' : 'bg-white text-slate-500 border-borde hover:border-slate-300'
                      }`}
                    >
                      {activa ? '✓ ' : ''}{t.nombre} ({(Number(t.tasa) * 100).toFixed(0)}%)
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-5">
            <label className="etiqueta">Notas (opcional)</label>
            <input value={notas} disabled={soloLectura} onChange={(e) => setNotas(e.target.value)} className="entrada" />
          </div>
        </div>

        <div className="tarjeta p-6 sticky top-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400 mb-4">Resumen</div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="cifra">{montoSiempre(totales.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">IVA acreditable ({(tasaIva * 100).toFixed(0)}%)</dt><dd className="cifra">{montoSiempre(totales.iva)}</dd></div>
            <div className="flex justify-between border-t border-borde pt-3 mt-3">
              <dt className="font-bold text-tinta">Total factura C$</dt>
              <dd className="cifra text-lg font-bold text-tinta">{montoSiempre(totales.total)}</dd>
            </div>
            {retencion > 0 && (
              <>
                <div className="flex justify-between text-ambar">
                  <dt>− Retención (a la DGI)</dt>
                  <dd className="cifra">{montoSiempre(retencion)}</dd>
                </div>
                <div className="flex justify-between border-t border-borde pt-2 mt-1">
                  <dt className="font-bold text-tinta">Neto a pagar C$</dt>
                  <dd className="cifra text-xl font-bold text-verde-oscuro">{montoSiempre(netoAPagar)}</dd>
                </div>
              </>
            )}
          </dl>

          {!soloLectura && (
            <div className="mt-6 space-y-2">
              <button onClick={() => void registrar()} disabled={!valida || ocupado} className="boton-primario w-full">
                Registrar compra
              </button>
              <button onClick={() => void guardarBorrador()} disabled={!valida || ocupado} className="boton-suave w-full">
                Guardar borrador
              </button>
              {compra && (
                <button onClick={() => void descartar()} disabled={ocupado} className="boton-peligro w-full">
                  Descartar borrador
                </button>
              )}
            </div>
          )}
          {!soloLectura && (
            <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
              Al registrar: asiento (Inventario + IVA acreditable contra {tipoPago === 'credito' ? 'CxP' : 'Caja'}),
              entrada al kardex y recálculo del costo promedio.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- órdenes */

function TabOrdenes({ alConvertir }: { alConvertir: (p: PrefillCompra) => void }) {
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [proveedores, setProveedores] = useState<Cliente[]>([]);
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [aviso, setAviso] = useState('');
  const [form, setForm] = useState<{
    id: number | null;
    tercero_id: string;
    fecha: string;
    bodega: string;
    notas: string;
    lineas: Array<{ productoId: string; descripcion: string; cantidad: string; costo: string }>;
  } | null>(null);

  const cargar = () => api.get<OrdenCompra[]>('/ordenes').then(setOrdenes).catch(() => setAviso('❌ Error cargando órdenes'));
  useEffect(() => {
    void cargar();
    api.get<Cliente[]>('/proveedores').then((p) => setProveedores(p.filter((x) => x.activo))).catch(() => undefined);
    api.get<Bodega[]>('/configuracion/bodegas').then((b) => setBodegas(b.filter((x) => x.activa))).catch(() => undefined);
    api.get<Producto[]>('/productos').then((p) => setProductos(p.filter((x) => x.activo))).catch(() => undefined);
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setAviso('');
    const datos = {
      tercero_id: Number(form.tercero_id),
      fecha: form.fecha,
      bodega: form.bodega || null,
      notas: form.notas,
      lineas: form.lineas
        .filter((l) => l.descripcion)
        .map((l) => ({
          producto_id: l.productoId ? Number(l.productoId) : null,
          descripcion: l.descripcion,
          cantidad: Number(l.cantidad),
          costo_unitario: Number(l.costo || 0),
        })),
    };
    try {
      if (form.id === null) await api.post('/ordenes', datos);
      else await api.put(`/ordenes/${form.id}`, datos);
      setAviso('✅ Orden guardada');
      setForm(null);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al guardar'}`);
    }
  }

  async function accion(ruta: string, cuerpoAccion?: unknown) {
    setAviso('');
    try {
      await api.post(ruta, cuerpoAccion);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error'}`);
    }
  }

  async function convertir(orden: OrdenCompra) {
    try {
      const completa = await api.get<OrdenCompra>(`/ordenes/${orden.id}`);
      alConvertir({
        orden_compra_id: completa.id,
        tercero_id: completa.tercero_id,
        bodega: completa.bodega ?? '',
        lineas: (completa.lineas ?? [])
          .filter((l) => l.producto_id)
          .map((l) => ({
            productoId: String(l.producto_id),
            cantidad: String(l.cantidad),
            costo: String(l.costo_unitario),
          })),
      });
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error'}`);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() =>
            setForm({
              id: null,
              tercero_id: '',
              fecha: new Date().toISOString().slice(0, 10),
              bodega: '',
              notas: '',
              lineas: [{ productoId: '', descripcion: '', cantidad: '1', costo: '' }],
            })
          }
          className="boton-primario"
        >
          + Nueva orden
        </button>
      </div>
      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {form && (
        <form onSubmit={guardar} className="tarjeta p-6 mb-4">
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="etiqueta">Proveedor</label>
              <select required value={form.tercero_id} onChange={(e) => setForm({ ...form, tercero_id: e.target.value })} className="entrada">
                <option value="">— proveedor —</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="etiqueta">Fecha</label>
              <input type="date" required value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className="entrada" />
            </div>
            <div>
              <label className="etiqueta">Bodega destino</label>
              <select value={form.bodega} onChange={(e) => setForm({ ...form, bodega: e.target.value })} className="entrada">
                <option value="">— bodega —</option>
                {bodegas.map((b) => <option key={b.codigo} value={b.codigo}>{b.codigo} · {b.nombre}</option>)}
              </select>
            </div>
          </div>

          {form.lineas.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_90px_110px_30px] gap-2 mb-2 items-center">
              <select
                value={l.productoId}
                onChange={(e) => {
                  const producto = productos.find((p) => String(p.id) === e.target.value);
                  setForm({
                    ...form,
                    lineas: form.lineas.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            productoId: e.target.value,
                            descripcion: producto ? producto.nombre : x.descripcion,
                          }
                        : x
                    ),
                  });
                }}
                className="entrada"
              >
                <option value="">— libre —</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
              </select>
              <input value={l.descripcion} placeholder="Descripción…"
                onChange={(e) => setForm({ ...form, lineas: form.lineas.map((x, j) => (j === i ? { ...x, descripcion: e.target.value } : x)) })}
                className="entrada" />
              <input type="number" min="0" step="0.01" value={l.cantidad}
                onChange={(e) => setForm({ ...form, lineas: form.lineas.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)) })}
                className="entrada text-right" />
              <input type="number" min="0" step="0.01" value={l.costo} placeholder="costo est."
                onChange={(e) => setForm({ ...form, lineas: form.lineas.map((x, j) => (j === i ? { ...x, costo: e.target.value } : x)) })}
                className="entrada text-right" />
              {form.lineas.length > 1 && (
                <button type="button" onClick={() => setForm({ ...form, lineas: form.lineas.filter((_, j) => j !== i) })}
                  className="text-slate-300 hover:text-rojo">✕</button>
              )}
            </div>
          ))}
          <button type="button"
            onClick={() => setForm({ ...form, lineas: [...form.lineas, { productoId: '', descripcion: '', cantidad: '1', costo: '' }] })}
            className="text-sm font-semibold text-verde hover:text-verde-oscuro">+ Agregar línea</button>

          <div className="flex gap-2 mt-5">
            <button type="submit" className="boton-primario">Guardar</button>
            <button type="button" onClick={() => setForm(null)} className="boton-suave">Cancelar</button>
          </div>
        </form>
      )}

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr><th>#</th><th>Fecha</th><th>Proveedor</th><th className="text-right">Total est. C$</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {ordenes.length === 0 && (
              <tr><td colSpan={6} className="py-14 text-center text-slate-400">Sin órdenes de compra</td></tr>
            )}
            {ordenes.map((o) => (
              <tr key={o.id}>
                <td className="cifra font-medium">OC-{String(o.id).padStart(4, '0')}</td>
                <td>{o.fecha.slice(0, 10)}</td>
                <td className="font-medium">{o.proveedor}</td>
                <td className="text-right cifra">{montoSiempre(o.total)}</td>
                <td><InsigniaEstado estado={o.estado} /></td>
                <td className="text-right space-x-3 whitespace-nowrap">
                  {o.estado === 'borrador' && (
                    <>
                      <button
                        onClick={() => {
                          void api.get<OrdenCompra>(`/ordenes/${o.id}`).then((completa) =>
                            setForm({
                              id: completa.id,
                              tercero_id: String(completa.tercero_id),
                              fecha: completa.fecha.slice(0, 10),
                              bodega: completa.bodega ?? '',
                              notas: completa.notas ?? '',
                              lineas: (completa.lineas ?? []).map((l) => ({
                                productoId: l.producto_id ? String(l.producto_id) : '',
                                descripcion: l.descripcion,
                                cantidad: String(l.cantidad),
                                costo: String(l.costo_unitario),
                              })),
                            })
                          );
                        }}
                        className="text-sm font-semibold text-verde hover:text-verde-oscuro"
                      >
                        Editar
                      </button>
                      <button onClick={() => void accion(`/ordenes/${o.id}/aprobar`)} className="text-sm font-semibold text-verde hover:text-verde-oscuro">
                        Aprobar
                      </button>
                    </>
                  )}
                  {o.estado === 'aprobada' && (
                    <button onClick={() => void convertir(o)} className="text-sm font-semibold text-verde hover:text-verde-oscuro">
                      Convertir en compra →
                    </button>
                  )}
                  {(o.estado === 'borrador' || o.estado === 'aprobada') && (
                    <button
                      onClick={() => {
                        const motivo = prompt(`Motivo para anular la OC-${o.id}:`);
                        if (motivo) void accion(`/ordenes/${o.id}/anular`, { motivo });
                      }}
                      className="text-sm text-rojo hover:underline"
                    >
                      Anular
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- proveedores */

function TabProveedores() {
  const [proveedores, setProveedores] = useState<Cliente[]>([]);
  const [aviso, setAviso] = useState('');
  const [form, setForm] = useState<{ id: number | null; nombre: string; ruc: string; terminos_dias: string; activo: boolean } | null>(null);

  const cargar = () => api.get<Cliente[]>('/proveedores').then(setProveedores).catch(() => setAviso('❌ Error cargando proveedores'));
  useEffect(() => { void cargar(); }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setAviso('');
    const datos = { nombre: form.nombre, ruc: form.ruc || null, terminos_dias: Number(form.terminos_dias || 0), activo: form.activo };
    try {
      if (form.id === null) await api.post('/proveedores', datos);
      else await api.put(`/proveedores/${form.id}`, datos);
      setAviso(`✅ Proveedor "${form.nombre}" guardado`);
      setForm(null);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al guardar'}`);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setForm({ id: null, nombre: '', ruc: '', terminos_dias: '15', activo: true })} className="boton-primario">
          + Nuevo proveedor
        </button>
      </div>
      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {form && (
        <form onSubmit={guardar} className="tarjeta p-6 mb-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="etiqueta">Nombre o razón social</label>
              <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="entrada" />
            </div>
            <div>
              <label className="etiqueta">RUC</label>
              <input value={form.ruc} onChange={(e) => setForm({ ...form, ruc: e.target.value })} className="entrada cifra" />
            </div>
            <div>
              <label className="etiqueta">Términos de pago (días)</label>
              <input type="number" min="0" value={form.terminos_dias}
                onChange={(e) => setForm({ ...form, terminos_dias: e.target.value })} className="entrada text-right" />
            </div>
            <label className="flex items-end gap-2 text-sm text-slate-600 pb-2">
              <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
              Activo
            </label>
          </div>
          <div className="flex gap-2 mt-5">
            <button type="submit" className="boton-primario">Guardar</button>
            <button type="button" onClick={() => setForm(null)} className="boton-suave">Cancelar</button>
          </div>
        </form>
      )}

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr><th>Proveedor</th><th>RUC</th><th className="text-right">Términos</th><th className="text-right">Compras</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {proveedores.length === 0 && (
              <tr><td colSpan={6} className="py-14 text-center text-slate-400">Sin proveedores</td></tr>
            )}
            {proveedores.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">{p.nombre}</td>
                <td className="cifra text-slate-500">{p.ruc ?? '—'}</td>
                <td className="text-right text-slate-500">{p.terminos_dias > 0 ? `${p.terminos_dias} días` : 'contado'}</td>
                <td className="text-right cifra">{(p as Cliente & { compras_registradas?: number }).compras_registradas ?? 0}</td>
                <td>{p.activo ? <span className="insignia-verde">activo</span> : <span className="insignia-gris">inactivo</span>}</td>
                <td className="text-right">
                  <button
                    onClick={() => setForm({ id: p.id, nombre: p.nombre, ruc: p.ruc ?? '', terminos_dias: String(p.terminos_dias), activo: p.activo })}
                    className="text-sm font-semibold text-verde hover:text-verde-oscuro"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
