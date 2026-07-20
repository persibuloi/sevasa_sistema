import { useEffect, useMemo, useState } from 'react';
import { api, ErrorApi } from '../api';
import type { Bodega, Cliente, Factura, Producto, Serie, Vendedor } from '../tipos';
import { montoSiempre } from '../formato';

type Vista = { modo: 'lista' } | { modo: 'editor'; id: number | null };

export default function Facturas() {
  const [vista, setVista] = useState<Vista>({ modo: 'lista' });

  return vista.modo === 'lista' ? (
    <ListaFacturas alAbrir={(id) => setVista({ modo: 'editor', id })} />
  ) : (
    <EditorFactura id={vista.id} alVolver={() => setVista({ modo: 'lista' })} />
  );
}

/* ------------------------------------------------------------------ lista */

const FILTROS = [
  { clave: '', titulo: 'Todas' },
  { clave: 'borrador', titulo: 'Borradores' },
  { clave: 'emitida', titulo: 'Emitidas' },
  { clave: 'anulada', titulo: 'Anuladas' },
] as const;

function InsigniaEstado({ estado }: { estado: Factura['estado'] }) {
  if (estado === 'emitida') return <span className="insignia-verde">● Emitida</span>;
  if (estado === 'borrador') return <span className="insignia-ambar">◐ Borrador</span>;
  return <span className="insignia-roja">✕ Anulada</span>;
}

function ListaFacturas({ alAbrir }: { alAbrir: (id: number | null) => void }) {
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [total, setTotal] = useState(0);
  const [filtro, setFiltro] = useState<string>('');
  const [busqueda, setBusqueda] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(1);
  const [error, setError] = useState('');

  const POR_PAGINA = 50;
  const totalPaginas = Math.max(Math.ceil(total / POR_PAGINA), 1);

  useEffect(() => {
    setPagina(1);
  }, [filtro, busqueda, desde, hasta]);

  useEffect(() => {
    const temporizador = setTimeout(() => {
      const parametros = new URLSearchParams();
      if (filtro) parametros.set('estado', filtro);
      if (busqueda.trim()) parametros.set('q', busqueda.trim());
      if (desde) parametros.set('desde', desde);
      if (hasta) parametros.set('hasta', hasta);
      parametros.set('pagina', String(pagina));
      parametros.set('por_pagina', String(POR_PAGINA));
      api
        .get<{ facturas: Factura[]; total: number }>(`/facturas?${parametros.toString()}`)
        .then((d) => {
          setFacturas(d.facturas);
          setTotal(d.total);
          setError('');
        })
        .catch((e) => setError(e instanceof ErrorApi ? e.message : 'Error cargando facturas'));
    }, busqueda ? 300 : 0);  // debounce solo al escribir
    return () => clearTimeout(temporizador);
  }, [filtro, busqueda, desde, hasta, pagina]);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-white border border-borde rounded-xl p-1">
            {FILTROS.map((f) => (
              <button
                key={f.clave}
                onClick={() => setFiltro(f.clave)}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold transition ${
                  filtro === f.clave ? 'bg-tinta text-white' : 'text-slate-500 hover:text-tinta'
                }`}
              >
                {f.titulo}
              </button>
            ))}
          </div>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar Nº o cliente…"
            className="entrada max-w-48"
          />
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="entrada max-w-36" title="Desde" />
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="entrada max-w-36" title="Hasta" />
        </div>
        <button onClick={() => alAbrir(null)} className="boton-primario">
          + Nueva factura
        </button>
      </div>

      {error && <p className="text-sm text-rojo mb-3">{error}</p>}

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Número</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Tienda</th>
              <th>Pago</th>
              <th className="text-right">Total C$</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {facturas.length === 0 && (
              <tr>
                <td colSpan={7} className="py-14 text-center text-slate-400">
                  No hay facturas {filtro ? `en "${filtro}"` : 'todavía'} — creá la primera con «Nueva factura»
                </td>
              </tr>
            )}
            {facturas.map((f) => (
              <tr key={f.id} onClick={() => alAbrir(f.id)} className="cursor-pointer">
                <td className="cifra font-medium">
                  {f.numero_completo ?? <span className="text-slate-400">borrador #{f.id}</span>}
                </td>
                <td>{f.fecha.slice(0, 10)}</td>
                <td className="font-medium">{f.cliente}</td>
                <td className="text-slate-500">{f.tienda}</td>
                <td className="text-slate-500 capitalize">{f.tipo_pago}</td>
                <td className="text-right cifra font-medium">{montoSiempre(f.total)}</td>
                <td><InsigniaEstado estado={f.estado} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 text-sm text-slate-500">
        <span>{total} factura{total === 1 ? '' : 's'}</span>
        {totalPaginas > 1 && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPagina(Math.max(pagina - 1, 1))}
              disabled={pagina <= 1}
              className="boton-suave px-3 py-1 disabled:opacity-40"
            >
              ← Anterior
            </button>
            <span className="cifra">página {pagina} de {totalPaginas}</span>
            <button
              onClick={() => setPagina(Math.min(pagina + 1, totalPaginas))}
              disabled={pagina >= totalPaginas}
              className="boton-suave px-3 py-1 disabled:opacity-40"
            >
              Siguiente →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- editor */

interface LineaForm {
  productoId: string;
  descripcion: string;
  cantidad: string;
  precio: string;
}

const LINEA_NUEVA: LineaForm = { productoId: '', descripcion: '', cantidad: '1', precio: '' };

function EditorFactura({ id, alVolver }: { id: number | null; alVolver: () => void }) {
  const [factura, setFactura] = useState<Factura | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [series, setSeries] = useState<Serie[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [filtrarPorBodega, setFiltrarPorBodega] = useState(true);
  const [bloquearSinExistencia, setBloquearSinExistencia] = useState(true);
  const [tasaIva, setTasaIva] = useState(0.15);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const [serie, setSerie] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [terceroId, setTerceroId] = useState('');
  const [vendedorId, setVendedorId] = useState('');
  const [bodegaId, setBodegaId] = useState('');
  const [numeroManual, setNumeroManual] = useState('');
  const [tipoPago, setTipoPago] = useState<'contado' | 'credito'>('contado');
  const [notas, setNotas] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([{ ...LINEA_NUEVA }]);
  const [modalLinea, setModalLinea] = useState<number | null>(null);

  const soloLectura = factura !== null && factura.estado !== 'borrador';
  const serieElegida = series.find((x) => x.serie === serie);
  const serieManual = serieElegida?.tipo === 'manual';
  // Amarre por tienda: solo vendedores de la sucursal de la serie (o sin asignar)
  const vendedoresDeTienda = useMemo(
    () =>
      vendedores.filter(
        (v) => !v.sucursal || !serieElegida?.sucursal || v.sucursal === serieElegida.sucursal
      ),
    [vendedores, serieElegida]
  );

  // Bodegas de la sucursal de la serie; la factura guarda su bodega EXPLÍCITA
  const bodegasDeSucursal = useMemo(() => {
    if (!serieElegida?.sucursal) return [];
    return bodegas
      .filter((b) => b.sucursal === serieElegida.sucursal)
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [bodegas, serieElegida]);

  useEffect(() => {
    if (bodegasDeSucursal.length === 0) {
      setBodegaId('');
      return;
    }
    if (!bodegasDeSucursal.some((b) => b.codigo === bodegaId)) {
      setBodegaId(bodegasDeSucursal[0]?.codigo ?? '');
    }
  }, [bodegasDeSucursal]);  // eslint-disable-line react-hooks/exhaustive-deps

  const bodegaVenta = bodegasDeSucursal.find((b) => b.codigo === bodegaId) ?? null;

  // Productos con la existencia de ESA bodega
  useEffect(() => {
    api
      .get<Producto[]>(`/productos${bodegaId ? `?bodega=${encodeURIComponent(bodegaId)}` : ''}`)
      .then((p) => setProductos(p.filter((x) => x.activo)))
      .catch(() => undefined);
  }, [bodegaId]);

  // Parametrizable: la tienda solo ve los productos de SU bodega (con existencia)
  const productosVisibles = useMemo(() => {
    if (!filtrarPorBodega || !bodegaVenta) return productos;
    const enLineas = new Set(lineas.map((l) => l.productoId).filter(Boolean));
    return productos.filter(
      (p) => Number(p.existencia_bodega ?? 0) > 0 || enLineas.has(String(p.id))
    );
  }, [productos, filtrarPorBodega, bodegaVenta, lineas]);

  useEffect(() => {
    Promise.all([
      api.get<Cliente[]>('/clientes'),
      api.get<Serie[]>('/series'),
      api.get<Array<{ clave: string; valor: string }>>('/config'),
      api.get<Vendedor[]>('/configuracion/vendedores'),
      api.get<Bodega[]>('/configuracion/bodegas'),
    ])
      .then(([c, s, cfg, v, b]) => {
        setClientes(c.filter((x) => x.activo));
        const deFactura = s.filter((x) => x.activa && x.documento === 'factura');
        setSeries(deFactura);
        setVendedores(v.filter((x) => x.activo));
        setBodegas(b.filter((x) => x.activa));
        const tasa = cfg.find((x) => x.clave === 'tasa_iva');
        if (tasa) setTasaIva(Number(tasa.valor));
        const bloqueo = cfg.find((x) => x.clave === 'ventas_bloquear_sin_existencia');
        setBloquearSinExistencia((bloqueo?.valor ?? 'si') === 'si');
        const filtro = cfg.find((x) => x.clave === 'ventas_filtrar_por_bodega');
        setFiltrarPorBodega((filtro?.valor ?? 'si') === 'si');
        if (!id) setSerie(deFactura.find((x) => x.tipo === 'sistema')?.serie ?? deFactura[0]?.serie ?? '');
      })
      .catch(() => setAviso('❌ Error cargando catálogos'));

    if (id) {
      api
        .get<Factura>(`/facturas/${id}`)
        .then((f) => {
          setFactura(f);
          setSerie(f.serie);
          setFecha(f.fecha.slice(0, 10));
          setTerceroId(String(f.tercero_id));
          setVendedorId(f.vendedor_id ? String(f.vendedor_id) : '');
          if (f.bodega) setBodegaId(f.bodega);
          setTipoPago(f.tipo_pago);
          setNotas(f.notas ?? '');
          setLineas(
            (f.lineas ?? []).map((l) => ({
              productoId: l.producto_id ? String(l.producto_id) : '',
              descripcion: l.descripcion,
              cantidad: String(l.cantidad),
              precio: String(l.precio_unitario),
            }))
          );
        })
        .catch((e) => setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error cargando factura'}`));
    }
  }, [id]);

  const totales = useMemo(() => {
    let subtotalCent = 0;
    for (const l of lineas) {
      const cantidad = Number(l.cantidad || 0);
      const precioCent = Math.round(Number(l.precio || 0) * 100);
      if (cantidad > 0 && precioCent >= 0) subtotalCent += Math.round(cantidad * precioCent);
    }
    const ivaCent = Math.round(subtotalCent * tasaIva);
    return { subtotal: subtotalCent / 100, iva: ivaCent / 100, total: (subtotalCent + ivaCent) / 100 };
  }, [lineas, tasaIva]);

  // Con el bloqueo activo: productos cuya cantidad facturada supera la
  // existencia de la bodega (acumulado si el producto se repite en líneas)
  const faltantes = useMemo(() => {
    if (!bloquearSinExistencia || !bodegaVenta) return [] as Array<{ nombre: string; pide: number; hay: number }>;
    const pedido = new Map<string, number>();
    for (const l of lineas) {
      if (l.productoId && Number(l.cantidad) > 0) {
        pedido.set(l.productoId, (pedido.get(l.productoId) ?? 0) + Number(l.cantidad));
      }
    }
    const res: Array<{ nombre: string; pide: number; hay: number }> = [];
    for (const [pid, pide] of pedido) {
      const p = productos.find((x) => String(x.id) === pid);
      const hay = Number(p?.existencia_bodega ?? 0);
      if (p && pide > hay) res.push({ nombre: `${p.codigo} · ${p.nombre}`, pide, hay });
    }
    return res;
  }, [bloquearSinExistencia, bodegaVenta, lineas, productos]);

  const valida =
    serie !== '' &&
    terceroId !== '' &&
    lineas.some((l) => l.descripcion && Number(l.cantidad) > 0 && Number(l.precio) > 0);
  const puedeEmitir = valida && faltantes.length === 0;  // el borrador sí se guarda

  function cuerpo() {
    return {
      serie,
      fecha,
      tercero_id: Number(terceroId),
      vendedor_id: vendedorId ? Number(vendedorId) : null,
      bodega: bodegaId || null,
      tipo_pago: tipoPago,
      notas,
      lineas: lineas
        .filter((l) => l.descripcion)
        .map((l) => ({
          producto_id: l.productoId ? Number(l.productoId) : null,
          descripcion: l.descripcion,
          cantidad: Number(l.cantidad),
          precio_unitario: Number(l.precio),
        })),
    };
  }

  async function guardarBorrador(): Promise<Factura | null> {
    setOcupado(true);
    setAviso('');
    try {
      const guardada = factura
        ? await api.put<Factura>(`/facturas/${factura.id}`, cuerpo())
        : await api.post<Factura>('/facturas', cuerpo());
      setFactura(guardada);
      setAviso('✅ Borrador guardado');
      return guardada;
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al guardar'}`);
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function emitir() {
    const mensaje = serieManual
      ? `¿Grabar la factura de papel Nº ${numeroManual}? Generará su asiento con la fecha real del documento.`
      : '¿Emitir la factura? Tomará número consecutivo y generará su asiento. Después no se puede editar.';
    if (!confirm(mensaje)) return;
    const guardada = await guardarBorrador();
    if (!guardada) return;
    setOcupado(true);
    try {
      const emitida = await api.post<Factura>(
        `/facturas/${guardada.id}/emitir`,
        serieManual ? { numero_manual: Number(numeroManual) } : {}
      );
      setFactura(emitida);
      setAviso(`✅ ${serieManual ? 'Grabada' : 'Emitida'} como ${emitida.numero_completo}`);
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al emitir'}`);
    } finally {
      setOcupado(false);
    }
  }

  async function anular() {
    if (!factura) return;
    const motivo = prompt(`Motivo para anular ${factura.numero_completo} (queda en bitácora):`);
    if (!motivo) return;
    setOcupado(true);
    setAviso('');
    try {
      const anulada = await api.post<Factura>(`/facturas/${factura.id}/anular`, { motivo });
      setFactura(anulada);
      setAviso(`✅ Factura ${anulada.numero_completo} anulada (el número se conserva)`);
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al anular'}`);
    } finally {
      setOcupado(false);
    }
  }

  async function descartar() {
    if (!factura) {
      alVolver();
      return;
    }
    if (!confirm('¿Descartar este borrador? No queda rastro (los borradores no tienen número).')) return;
    try {
      await api.borrar(`/facturas/${factura.id}`);
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

      {factura && factura.estado !== 'borrador' && (
        <div className={`tarjeta px-6 py-4 mb-4 flex items-center justify-between flex-wrap gap-3 ${
          factura.estado === 'anulada' ? 'opacity-80' : ''
        }`}>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Factura</div>
            <div className="text-2xl font-extrabold cifra text-tinta">{factura.numero_completo}</div>
          </div>
          <InsigniaEstado estado={factura.estado} />
          {factura.estado === 'emitida' && (
            <button onClick={() => void anular()} disabled={ocupado} className="boton-peligro">
              Anular factura
            </button>
          )}
        </div>
      )}

      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      <div className="grid lg:grid-cols-[1fr_290px] gap-4 items-start">
        {/* Formulario */}
        <div className="tarjeta p-6">
          <div className="grid md:grid-cols-2 gap-4 mb-5">
            <div>
              <label className="etiqueta">Cliente</label>
              <select
                value={terceroId}
                onChange={(e) => setTerceroId(e.target.value)}
                disabled={soloLectura}
                className="entrada"
              >
                <option value="">— elegir cliente —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="etiqueta">Fecha</label>
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  disabled={soloLectura}
                  className="entrada"
                />
              </div>
              <div>
                <label className="etiqueta">Serie / tienda</label>
                <select
                  value={serie}
                  onChange={(e) => setSerie(e.target.value)}
                  disabled={soloLectura || factura !== null}
                  className="entrada"
                >
                  <option value="">— serie —</option>
                  {series.map((s) => (
                    <option key={s.serie} value={s.serie}>
                      {s.serie} · {s.sucursal_nombre ?? s.tienda ?? ''}{s.tipo === 'manual' ? ' · MANUAL' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-5">
            <div>
              <label className="etiqueta">Vendedor (opcional)</label>
              <select
                value={vendedorId}
                onChange={(e) => setVendedorId(e.target.value)}
                disabled={soloLectura}
                className="entrada"
              >
                <option value="">— sin vendedor —</option>
                {vendedoresDeTienda.map((v) => (
                  <option key={v.id} value={v.id}>{v.codigo ? `${v.codigo} · ` : ''}{v.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="etiqueta">Bodega de despacho</label>
              <select
                value={bodegaId}
                onChange={(e) => setBodegaId(e.target.value)}
                disabled={soloLectura || bodegasDeSucursal.length === 0}
                className="entrada"
              >
                {bodegasDeSucursal.length === 0 && <option value="">— la sucursal no tiene bodegas —</option>}
                {bodegasDeSucursal.map((b) => (
                  <option key={b.codigo} value={b.codigo}>{b.codigo} · {b.nombre}</option>
                ))}
              </select>
            </div>
            {serieManual && !soloLectura && (
              <div>
                <label className="etiqueta">Nº de la factura de papel</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={numeroManual}
                  onChange={(e) => setNumeroManual(e.target.value)}
                  placeholder="el número impreso en el talonario"
                  className="entrada cifra"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Serie manual: usá la fecha REAL del papel; el número no se genera, se digita.
                </p>
              </div>
            )}
          </div>

          <div className="mb-5">
            <label className="etiqueta">Forma de pago</label>
            <div className="inline-flex rounded-lg border border-borde bg-fondo p-1">
              {(['contado', 'credito'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={soloLectura}
                  onClick={() => setTipoPago(t)}
                  className={`px-4 py-1.5 rounded-md text-sm font-semibold capitalize transition ${
                    tipoPago === t ? 'bg-white text-tinta shadow-sm border border-borde' : 'text-slate-500'
                  }`}
                >
                  {t === 'contado' ? 'Contado' : 'Crédito'}
                </button>
              ))}
            </div>
            {tipoPago === 'credito' && (
              <span className="ml-3 text-xs text-slate-400">se carga a la cuenta del cliente (CxC)</span>
            )}
          </div>

          {/* Líneas */}
          <div className="flex items-center justify-between">
            <label className="etiqueta">Detalle</label>
            {filtrarPorBodega && bodegaVenta && (
              <span className="text-[11px] text-slate-400 mb-1.5">
                Mostrando productos con existencia en {bodegaVenta.nombre}
              </span>
            )}
          </div>
          <table className="w-full text-sm mb-2">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 text-left">
                <th className="pb-2 w-44">Producto</th>
                <th className="pb-2">Descripción</th>
                <th className="pb-2 w-24">Cant.</th>
                <th className="pb-2 w-32">Precio unit.</th>
                <th className="pb-2 w-28 text-right">Importe</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => {
                const importe = Math.round(Number(l.cantidad || 0) * Math.round(Number(l.precio || 0) * 100)) / 100;
                return (
                  <tr key={i}>
                    <td className="py-1 pr-2">
                      {(() => {
                        const prod = productos.find((p) => String(p.id) === l.productoId);
                        const disp = Number(prod?.existencia_bodega ?? 0);
                        return (
                          <button
                            type="button"
                            disabled={soloLectura}
                            onClick={() => setModalLinea(i)}
                            className="entrada text-left flex items-center justify-between gap-1 disabled:bg-fondo"
                            title={prod ? `${prod.codigo} · ${prod.nombre}` : 'Buscar producto'}
                          >
                            {prod ? (
                              <>
                                <span className="cifra truncate">{prod.codigo}</span>
                                {bodegaVenta && (
                                  <span className={`cifra text-[11px] shrink-0 ${disp <= 0 ? 'text-rojo font-semibold' : 'text-slate-400'}`}>
                                    {disp}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-400">🔍 Buscar…</span>
                            )}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        value={l.descripcion}
                        disabled={soloLectura}
                        placeholder="Producto o servicio…"
                        onChange={(e) =>
                          setLineas(lineas.map((x, j) => (j === i ? { ...x, descripcion: e.target.value } : x)))
                        }
                        className="entrada"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.cantidad}
                        disabled={soloLectura}
                        onChange={(e) =>
                          setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))
                        }
                        className="entrada text-right"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.precio}
                        disabled={soloLectura}
                        placeholder="0.00"
                        onChange={(e) =>
                          setLineas(lineas.map((x, j) => (j === i ? { ...x, precio: e.target.value } : x)))
                        }
                        className="entrada text-right"
                      />
                    </td>
                    <td className="py-1 text-right cifra text-slate-600">{montoSiempre(importe)}</td>
                    <td className="text-center">
                      {!soloLectura && lineas.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setLineas(lineas.filter((_, j) => j !== i))}
                          className="text-slate-300 hover:text-rojo transition-colors"
                          title="Quitar línea"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!soloLectura && (
            <button
              type="button"
              onClick={() => setLineas([...lineas, { ...LINEA_NUEVA }])}
              className="text-sm font-semibold text-verde hover:text-verde-oscuro"
            >
              + Agregar línea
            </button>
          )}

          <div className="mt-5">
            <label className="etiqueta">Notas (opcional)</label>
            <input
              value={notas}
              disabled={soloLectura}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Observaciones internas…"
              className="entrada"
            />
          </div>
        </div>

        {/* Resumen */}
        <div className="tarjeta p-6 sticky top-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400 mb-4">Resumen</div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="cifra">{montoSiempre(totales.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">IVA ({(tasaIva * 100).toFixed(0)}%)</dt>
              <dd className="cifra">{montoSiempre(totales.iva)}</dd>
            </div>
            <div className="flex justify-between border-t border-borde pt-3 mt-3">
              <dt className="font-bold text-tinta">Total C$</dt>
              <dd className="cifra text-xl font-bold text-verde-oscuro">{montoSiempre(totales.total)}</dd>
            </div>
          </dl>

          {!soloLectura && faltantes.length > 0 && (
            <div className="mt-4 rounded-lg bg-rojo-suave border border-rojo/20 p-3 text-[12px]">
              <p className="font-semibold text-rojo mb-1">Sin existencia suficiente en {bodegaVenta?.nombre}:</p>
              {faltantes.map((f) => (
                <p key={f.nombre} className="text-rojo/90">
                  {f.nombre}: pedís <strong className="cifra">{f.pide}</strong>, hay <strong className="cifra">{f.hay}</strong>
                </p>
              ))}
              <p className="text-slate-500 mt-1">Ajustá la cantidad o hacé un traslado a esta bodega.</p>
            </div>
          )}

          {!soloLectura && (
            <div className="mt-6 space-y-2">
              <button
                onClick={() => void emitir()}
                disabled={!puedeEmitir || ocupado || (serieManual && !(Number(numeroManual) > 0))}
                className="boton-primario w-full"
              >
                {serieManual ? 'Grabar factura manual' : 'Emitir factura'}
              </button>
              <button onClick={() => void guardarBorrador()} disabled={!valida || ocupado} className="boton-suave w-full">
                Guardar borrador
              </button>
              {factura && (
                <button onClick={() => void descartar()} disabled={ocupado} className="boton-peligro w-full">
                  Descartar borrador
                </button>
              )}
            </div>
          )}
          {!soloLectura && (
            <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
              El número consecutivo se asigna únicamente al emitir. Un borrador descartado no quema números.
            </p>
          )}
        </div>
      </div>

      {modalLinea !== null && (
        <ModalProductos
          productos={filtrarPorBodega && bodegaVenta ? productosVisibles : productos}
          bodegaNombre={bodegaVenta?.nombre ?? null}
          alCerrar={() => setModalLinea(null)}
          alElegir={(p) => {
            setLineas((previas) =>
              previas.map((x, j) =>
                j === modalLinea
                  ? p
                    ? { ...x, productoId: String(p.id), descripcion: p.nombre, precio: String(p.precio_venta) }
                    : { ...x, productoId: '', descripcion: x.descripcion }
                  : x
              )
            );
            setModalLinea(null);
          }}
        />
      )}
    </div>
  );
}

function ModalProductos({
  productos,
  bodegaNombre,
  alElegir,
  alCerrar,
}: {
  productos: Producto[];
  bodegaNombre: string | null;
  alElegir: (p: Producto | null) => void;
  alCerrar: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const q = busqueda.trim().toLowerCase();
  const filtrados = useMemo(
    () =>
      !q
        ? productos
        : productos.filter(
            (p) => p.codigo.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q)
          ),
    [productos, q]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-tinta/40 p-4 pt-[8vh]" onClick={alCerrar}>
      <div className="w-full max-w-2xl tarjeta p-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-borde">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-tinta">
              Buscar producto{bodegaNombre ? <span className="font-normal text-slate-400"> · existencia en {bodegaNombre}</span> : null}
            </h3>
            <button onClick={alCerrar} className="text-slate-400 hover:text-tinta">✕</button>
          </div>
          <input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtrados[0]) alElegir(filtrados[0]);
              if (e.key === 'Escape') alCerrar();
            }}
            placeholder="Código o nombre… (Enter elige el primero)"
            className="entrada"
          />
        </div>
        <div className="max-h-[55vh] overflow-y-auto">
          <table className="tabla">
            <thead className="sticky top-0">
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th className="text-right">Existencia</th>
                <th className="text-right">Precio C$</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 && (
                <tr><td colSpan={4} className="py-10 text-center text-slate-400">Sin coincidencias</td></tr>
              )}
              {filtrados.slice(0, 100).map((p) => {
                const disp = Number(p.existencia_bodega ?? 0);
                return (
                  <tr key={p.id} onClick={() => alElegir(p)} className="cursor-pointer">
                    <td className="cifra font-medium">{p.codigo}</td>
                    <td>{p.nombre}</td>
                    <td className={`text-right cifra ${disp <= 0 ? 'text-rojo font-semibold' : ''}`}>{disp}</td>
                    <td className="text-right cifra">{montoSiempre(p.precio_venta)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtrados.length > 100 && (
            <p className="p-3 text-center text-xs text-slate-400">Mostrando 100 de {filtrados.length} — afiná la búsqueda</p>
          )}
        </div>
        <div className="p-3 border-t border-borde flex justify-between">
          <button onClick={() => alElegir(null)} className="text-sm text-slate-500 hover:text-tinta">
            Línea libre (servicio, sin producto)
          </button>
          <button onClick={alCerrar} className="boton-suave px-4 py-1.5">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
