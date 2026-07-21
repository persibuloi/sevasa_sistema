import { useEffect, useMemo, useState } from 'react';
import { api, ErrorApi } from '../api';
import type { Bodega, Producto, Sesion, Traslado } from '../tipos';
import { montoSiempre } from '../formato';

interface LineaForm {
  productoId: string;
  cantidad: string;
}

export default function Traslados() {
  const [traslados, setTraslados] = useState<Traslado[]>([]);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [aviso, setAviso] = useState('');

  const cargar = () => api.get<Traslado[]>('/traslados').then(setTraslados).catch(() => setAviso('❌ Error cargando traslados'));
  useEffect(() => { void cargar(); }, []);

  async function anular(t: Traslado) {
    const motivo = prompt(`Motivo para anular el traslado #${t.id} (la mercadería regresa a ${t.origen_nombre}):`);
    if (!motivo) return;
    setAviso('');
    try {
      await api.post(`/traslados/${t.id}/anular`, { motivo });
      setAviso(`✅ Traslado #${t.id} anulado — mercadería de regreso en ${t.origen_nombre}`);
      await cargar();
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al anular'}`);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="flex justify-end mb-3">
        <button onClick={() => setMostrandoForm(!mostrandoForm)} className="boton-primario">
          {mostrandoForm ? 'Ocultar formulario' : '+ Nuevo traslado'}
        </button>
      </div>
      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {mostrandoForm && (
        <FormTraslado
          alRealizar={(mensaje) => {
            setAviso(mensaje);
            setMostrandoForm(false);
            void cargar();
          }}
        />
      )}

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>#</th><th>Fecha</th><th>De</th><th>Hacia</th>
              <th className="text-right">Líneas</th><th className="text-right">Valor C$</th><th>Estado</th><th></th>
            </tr>
          </thead>
          <tbody>
            {traslados.length === 0 && (
              <tr><td colSpan={8} className="py-14 text-center text-slate-400">
                Sin traslados — la mercadería se recibe en la bodega central y de aquí se reparte a las tiendas
              </td></tr>
            )}
            {traslados.map((t) => (
              <tr key={t.id} className={t.estado === 'anulado' ? 'opacity-50' : ''}>
                <td className="cifra font-medium">TR-{String(t.id).padStart(4, '0')}</td>
                <td>{t.fecha.slice(0, 10)}</td>
                <td className="font-medium">{t.origen_nombre}</td>
                <td className="font-medium">→ {t.destino_nombre}</td>
                <td className="text-right cifra">{typeof t.lineas === 'number' ? t.lineas : t.lineas?.length ?? 0}</td>
                <td className="text-right cifra">{montoSiempre(t.valor)}</td>
                <td>
                  {t.estado === 'realizado'
                    ? <span className="insignia-verde">● realizado</span>
                    : <span className="insignia-roja">✕ anulado</span>}
                </td>
                <td className="text-right">
                  {t.estado === 'realizado' && (
                    <button onClick={() => void anular(t)} className="text-sm text-rojo hover:underline">Anular</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Un traslado no genera asiento contable: la cuenta de inventario no cambia, solo la ubicación física.
        Queda registrado en el kardex de cada bodega al costo promedio del momento.
      </p>
    </div>
  );
}

function FormTraslado({ alRealizar }: { alRealizar: (mensaje: string) => void }) {
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [bodegasOrigen, setBodegasOrigen] = useState<Bodega[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [notas, setNotas] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([{ productoId: '', cantidad: '' }]);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    Promise.all([api.get<Bodega[]>('/configuracion/bodegas'), api.get<Sesion>('/yo')])
      .then(([b, yo]) => {
        const activas = b.filter((x) => x.activa);
        setBodegas(activas);
        // Amarre duro (espejo del backend): con bodega asignada solo se origina
        // desde ella; con solo sucursal, desde las bodegas de esa sucursal
        const admin = yo.roles.includes('admin');
        let origenes = activas;
        if (!admin && yo.bodega) origenes = activas.filter((x) => x.codigo === yo.bodega);
        else if (!admin && yo.sucursal) origenes = activas.filter((x) => x.sucursal === yo.sucursal);
        setBodegasOrigen(origenes);
        if (origenes.length === 1) setOrigen(origenes[0]?.codigo ?? '');
      })
      .catch(() => undefined);
  }, []);

  // Productos con existencia en la bodega ORIGEN (solo se traslada lo que hay)
  useEffect(() => {
    setProductos([]);
    if (!origen) return;
    api
      .get<Producto[]>(`/productos?bodega=${encodeURIComponent(origen)}`)
      .then((p) => setProductos(p.filter((x) => x.activo && Number(x.existencia_bodega ?? 0) > 0)))
      .catch(() => undefined);
  }, [origen]);

  const valida = useMemo(
    () =>
      origen !== '' && destino !== '' && origen !== destino &&
      lineas.some((l) => l.productoId && Number(l.cantidad) > 0),
    [origen, destino, lineas]
  );

  async function realizar() {
    setAviso('');
    setOcupado(true);
    try {
      const t = await api.post<Traslado>('/traslados', {
        fecha,
        bodega_origen: origen,
        bodega_destino: destino,
        notas,
        lineas: lineas
          .filter((l) => l.productoId && Number(l.cantidad) > 0)
          .map((l) => ({ producto_id: Number(l.productoId), cantidad: Number(l.cantidad) })),
      });
      alRealizar(`✅ Traslado TR-${String(t.id).padStart(4, '0')} realizado`);
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al realizar el traslado'}`);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="tarjeta p-6 mb-4">
      <div className="grid md:grid-cols-4 gap-4 mb-4">
        <div>
          <label className="etiqueta">Bodega origen</label>
          <select value={origen} onChange={(e) => setOrigen(e.target.value)} className="entrada">
            <option value="">— origen —</option>
            {bodegasOrigen.map((b) => <option key={b.codigo} value={b.codigo}>{b.codigo} · {b.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="etiqueta">Bodega destino</label>
          <select value={destino} onChange={(e) => setDestino(e.target.value)} className="entrada">
            <option value="">— destino —</option>
            {bodegas.filter((b) => b.codigo !== origen).map((b) => (
              <option key={b.codigo} value={b.codigo}>{b.codigo} · {b.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta">Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="entrada" />
        </div>
        <div>
          <label className="etiqueta">Notas (opcional)</label>
          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Camión, guía…" className="entrada" />
        </div>
      </div>

      {origen && (
        <>
          <label className="etiqueta">Qué se traslada</label>
          {productos.length === 0 ? (
            <p className="text-sm text-slate-400 mb-3">La bodega origen no tiene productos con existencia.</p>
          ) : (
            <>
              {lineas.map((l, i) => {
                const producto = productos.find((p) => String(p.id) === l.productoId);
                return (
                  <div key={i} className="grid grid-cols-[1fr_120px_140px_30px] gap-2 mb-2 items-center">
                    <select
                      value={l.productoId}
                      onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, productoId: e.target.value } : x)))}
                      className="entrada"
                    >
                      <option value="">— producto —</option>
                      {productos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.codigo} · {p.nombre} · disp. {Number(p.existencia_bodega)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number" min="0" step="0.01" value={l.cantidad} placeholder="cantidad"
                      max={producto ? Number(producto.existencia_bodega) : undefined}
                      onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))}
                      className="entrada text-right"
                    />
                    <span className="text-xs text-slate-400 cifra">
                      {producto ? `máx. ${Number(producto.existencia_bodega)} ${producto.unidad}` : ''}
                    </span>
                    {lineas.length > 1 && (
                      <button type="button" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}
                        className="text-slate-300 hover:text-rojo">✕</button>
                    )}
                  </div>
                );
              })}
              <button type="button" onClick={() => setLineas([...lineas, { productoId: '', cantidad: '' }])}
                className="text-sm font-semibold text-verde hover:text-verde-oscuro">+ Agregar línea</button>
            </>
          )}
        </>
      )}

      <div className="flex justify-end mt-4">
        <button onClick={() => void realizar()} disabled={!valida || ocupado} className="boton-primario">
          Realizar traslado
        </button>
      </div>
      {aviso && <p className="text-sm mt-3">{aviso}</p>}
    </div>
  );
}
