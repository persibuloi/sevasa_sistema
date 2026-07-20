import { useEffect, useMemo, useState } from 'react';
import { api, ErrorApi } from '../api';
import type { Cliente, Factura, Producto, Serie, Vendedor } from '../tipos';
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
  const [filtro, setFiltro] = useState<string>('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Factura[]>(`/facturas${filtro ? `?estado=${filtro}` : ''}`)
      .then((f) => {
        setFacturas(f);
        setError('');
      })
      .catch((e) => setError(e instanceof ErrorApi ? e.message : 'Error cargando facturas'));
  }, [filtro]);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
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
  const [tasaIva, setTasaIva] = useState(0.15);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const [serie, setSerie] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [terceroId, setTerceroId] = useState('');
  const [vendedorId, setVendedorId] = useState('');
  const [numeroManual, setNumeroManual] = useState('');
  const [tipoPago, setTipoPago] = useState<'contado' | 'credito'>('contado');
  const [notas, setNotas] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([{ ...LINEA_NUEVA }]);

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

  useEffect(() => {
    Promise.all([
      api.get<Cliente[]>('/clientes'),
      api.get<Serie[]>('/series'),
      api.get<Array<{ clave: string; valor: string }>>('/config'),
      api.get<Vendedor[]>('/configuracion/vendedores'),
      api.get<Producto[]>('/productos'),
    ])
      .then(([c, s, cfg, v, p]) => {
        setClientes(c.filter((x) => x.activo));
        const deFactura = s.filter((x) => x.activa && x.documento === 'factura');
        setSeries(deFactura);
        setVendedores(v.filter((x) => x.activo));
        setProductos(p.filter((x) => x.activo));
        const tasa = cfg.find((x) => x.clave === 'tasa_iva');
        if (tasa) setTasaIva(Number(tasa.valor));
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

  const valida =
    serie !== '' &&
    terceroId !== '' &&
    lineas.some((l) => l.descripcion && Number(l.cantidad) > 0 && Number(l.precio) > 0);

  function cuerpo() {
    return {
      serie,
      fecha,
      tercero_id: Number(terceroId),
      vendedor_id: vendedorId ? Number(vendedorId) : null,
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

          <div className="grid md:grid-cols-2 gap-4 mb-5">
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
          <label className="etiqueta">Detalle</label>
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
                      <select
                        value={l.productoId}
                        disabled={soloLectura}
                        onChange={(e) => {
                          const producto = productos.find((p) => String(p.id) === e.target.value);
                          setLineas(
                            lineas.map((x, j) =>
                              j === i
                                ? producto
                                  ? {
                                      ...x,
                                      productoId: e.target.value,
                                      descripcion: producto.nombre,
                                      precio: String(producto.precio_venta),
                                    }
                                  : { ...x, productoId: '' }
                                : x
                            )
                          );
                        }}
                        className="entrada"
                      >
                        <option value="">— libre —</option>
                        {productos.map((p) => (
                          <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>
                        ))}
                      </select>
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

          {!soloLectura && (
            <div className="mt-6 space-y-2">
              <button
                onClick={() => void emitir()}
                disabled={!valida || ocupado || (serieManual && !(Number(numeroManual) > 0))}
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
    </div>
  );
}
