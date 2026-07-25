import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { api, ErrorApi } from '../api';
import type { Producto } from '../tipos';
import { montoSiempre } from '../formato';

const FORM_VACIO = {
  id: null as number | null,
  codigo: '',
  nombre: '',
  unidad: 'unidad',
  categoria: '',
  precio_venta: '',
  activo: true,
};

const POR_PAGINA = 50;

interface ExistenciaBodega {
  bodega: string;
  bodega_nombre: string;
  sucursal: string;
  cantidad: string | number;
}

export default function Productos() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [busqueda, setBusqueda] = useState('');
  const [form, setForm] = useState<typeof FORM_VACIO | null>(null);
  const [aviso, setAviso] = useState('');
  const [tc, setTc] = useState<{ fecha: string; tasa: string | number } | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [bodegasDe, setBodegasDe] = useState<Record<number, ExistenciaBodega[]>>({});

  // Búsqueda y paginación EN EL SERVIDOR: el catálogo real trae miles de filas
  async function cargar(p = pagina, q = busqueda) {
    try {
      const consulta = new URLSearchParams({ pagina: String(p), por_pagina: String(POR_PAGINA) });
      if (q.trim()) consulta.set('q', q.trim());
      const r = await api.get<{ productos: Producto[]; total: number }>(`/productos?${consulta}`);
      setProductos(r.productos);
      setTotal(r.total);
      setAbierto(null);
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error cargando productos'}`);
    }
  }
  useEffect(() => {
    api.get<{ fecha: string; tasa: string | number } | null>('/config/tipo-cambio').then(setTc).catch(() => undefined);
  }, []);
  // La búsqueda espera 300ms de silencio antes de ir al servidor
  useEffect(() => {
    const t = setTimeout(() => {
      setPagina(1);
      void cargar(1, busqueda);
    }, busqueda === '' ? 0 : 300);
    return () => clearTimeout(t);
  }, [busqueda]); // eslint-disable-line react-hooks/exhaustive-deps

  // El backend solo manda el costo a quien tiene permiso de inventario
  const veCostos = productos.some((p) => p.costo_promedio !== undefined);

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  function irA(p: number) {
    const destino = Math.min(Math.max(1, p), paginas);
    setPagina(destino);
    void cargar(destino);
  }

  async function verBodegas(p: Producto) {
    if (abierto === p.id) {
      setAbierto(null);
      return;
    }
    setAbierto(p.id);
    if (!bodegasDe[p.id]) {
      try {
        const filas = await api.get<ExistenciaBodega[]>(`/productos/${p.id}/existencias`);
        setBodegasDe((prev) => ({ ...prev, [p.id]: filas }));
      } catch {
        setAviso('❌ No se pudieron cargar las bodegas del producto');
      }
    }
  }

  const tasa = Number(tc?.tasa ?? 0);
  const enDolares = (monto: unknown): string =>
    tasa > 0 ? (Number(monto ?? 0) / tasa).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

  async function actualizarTc() {
    const nueva = prompt(`Tipo de cambio oficial del día (córdobas por US$)${tc ? ` — actual: ${Number(tc.tasa)}` : ''}:`);
    if (!nueva) return;
    try {
      const r = await api.post<{ fecha: string; tasa: string | number }>('/config/tipo-cambio', { tasa: Number(nueva.replace(',', '.')) });
      setTc(r);
      setAviso(`✅ Tipo de cambio del ${r.fecha.slice(0, 10)}: ${Number(r.tasa)} (queda en bitácora)`);
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'No se pudo actualizar el tipo de cambio'}`);
    }
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setAviso('');
    const datos = {
      codigo: form.codigo,
      nombre: form.nombre,
      unidad: form.unidad || 'unidad',
      categoria: form.categoria || null,
      precio_venta: Number(form.precio_venta || 0),
      activo: form.activo,
    };
    try {
      if (form.id === null) {
        await api.post('/productos', datos);
        setAviso(`✅ Producto ${form.codigo} creado`);
      } else {
        await api.put(`/productos/${form.id}`, datos);
        setAviso(`✅ Producto ${form.codigo} actualizado`);
      }
      setForm(null);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al guardar'}`);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por código, nombre o categoría…"
          className="entrada max-w-xs"
        />
        <div className="flex items-center gap-3">
          <button onClick={() => void actualizarTc()} title="Actualizar tipo de cambio oficial (BCN)"
            className="text-sm text-slate-500 hover:text-tinta">
            TC: <span className="cifra font-semibold">{tasa > 0 ? tasa.toFixed(4) : 'sin definir'}</span>
            {tc ? <span className="text-slate-400"> · {tc.fecha.slice(0, 10)}</span> : null} ✎
          </button>
          <button onClick={() => setForm({ ...FORM_VACIO })} className="boton-primario">
            + Nuevo producto
          </button>
        </div>
      </div>

      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {form && (
        <form onSubmit={guardar} className="tarjeta p-6 mb-4">
          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <label className="etiqueta">Código</label>
              <input
                required
                disabled={form.id !== null}
                value={form.codigo}
                placeholder="P-001"
                onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })}
                className="entrada cifra"
              />
            </div>
            <div className="md:col-span-3">
              <label className="etiqueta">Nombre</label>
              <input
                required
                value={form.nombre}
                placeholder="Cemento gris 42.5 kg"
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                className="entrada"
              />
            </div>
            <div>
              <label className="etiqueta">Unidad</label>
              <input
                value={form.unidad}
                placeholder="unidad, bolsa, galón…"
                onChange={(e) => setForm({ ...form, unidad: e.target.value })}
                className="entrada"
              />
            </div>
            <div>
              <label className="etiqueta">Categoría</label>
              <input
                value={form.categoria}
                placeholder="Construcción"
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                className="entrada"
              />
            </div>
            <div>
              <label className="etiqueta">Precio de venta C$</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.precio_venta}
                onChange={(e) => setForm({ ...form, precio_venta: e.target.value })}
                className="entrada text-right cifra"
              />
            </div>
            <label className="flex items-end gap-2 text-sm text-slate-600 pb-2">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(e) => setForm({ ...form, activo: e.target.checked })}
              />
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
            <tr>
              <th>Código</th>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Unidad</th>
              <th className="text-right">Existencia</th>
              {veCostos && <th className="text-right">Costo prom. C$</th>}
              {veCostos && <th className="text-right">Costo US$</th>}
              <th className="text-right">Precio C$</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {productos.length === 0 && (
              <tr>
                <td colSpan={10} className="py-14 text-center text-slate-400">
                  {busqueda ? 'Sin resultados' : 'Sin productos — creá el primero'}
                </td>
              </tr>
            )}
            {productos.map((p) => (
              <Fragment key={p.id}>
                <tr className={abierto === p.id ? 'bg-verde/5' : ''}>
                  <td className="cifra font-medium">{p.codigo}</td>
                  <td className="font-medium">{p.nombre}</td>
                  <td className="text-slate-500">{p.categoria ?? '—'}</td>
                  <td className="text-slate-500">{p.unidad}</td>
                  <td className={`text-right cifra ${Number(p.existencia ?? 0) < 0 ? 'text-rojo font-semibold' : ''}`}>
                    <button onClick={() => void verBodegas(p)} title="Ver existencias por bodega"
                      className="hover:text-verde font-medium">
                      {Number(p.existencia ?? 0)} {abierto === p.id ? '▾' : '▸'}
                    </button>
                  </td>
                  {veCostos && <td className="text-right cifra text-slate-500">{montoSiempre(p.costo_promedio)}</td>}
                  {veCostos && <td className="text-right cifra text-slate-500">{enDolares(p.costo_promedio)}</td>}
                  <td className="text-right cifra font-medium">{montoSiempre(p.precio_venta)}</td>
                  <td>
                    {p.activo ? <span className="insignia-verde">activo</span> : <span className="insignia-gris">inactivo</span>}
                  </td>
                  <td className="text-right space-x-3 whitespace-nowrap">
                    <button onClick={() => void verBodegas(p)}
                      className="text-sm text-slate-500 hover:text-tinta">Bodegas</button>
                    <button
                      onClick={() =>
                        setForm({
                          id: p.id,
                          codigo: p.codigo,
                          nombre: p.nombre,
                          unidad: p.unidad,
                          categoria: p.categoria ?? '',
                          precio_venta: String(p.precio_venta),
                          activo: p.activo,
                        })
                      }
                      className="text-sm font-semibold text-verde hover:text-verde-oscuro"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
                {abierto === p.id && (
                  <tr className="bg-verde/5">
                    <td colSpan={10} className="px-6 pb-4 pt-0">
                      {!bodegasDe[p.id] ? (
                        <span className="text-sm text-slate-400">Cargando bodegas…</span>
                      ) : bodegasDe[p.id]!.length === 0 ? (
                        <span className="text-sm text-slate-400">Sin existencia en ninguna bodega</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {bodegasDe[p.id]!.map((b) => (
                            <span key={b.bodega}
                              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm bg-white ${
                                Number(b.cantidad) < 0 ? 'border-rojo/40 text-rojo' : 'border-borde'
                              }`}>
                              <span className="cifra text-slate-400">{b.bodega}</span>
                              <span>{b.bodega_nombre}</span>
                              <span className="cifra font-semibold">{Number(b.cantidad)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
        <p className="text-xs text-slate-400">
          Clic en la existencia (o en Bodegas) para ver el detalle por bodega. Los cambios de precio quedan en bitácora.
        </p>
        {total > POR_PAGINA && (
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => irA(pagina - 1)} disabled={pagina <= 1}
              className="boton-suave disabled:opacity-40">‹ Anterior</button>
            <span className="text-slate-500">
              pág. <span className="cifra">{pagina}</span> de <span className="cifra">{paginas}</span> · <span className="cifra">{total}</span> productos
            </span>
            <button onClick={() => irA(pagina + 1)} disabled={pagina >= paginas}
              className="boton-suave disabled:opacity-40">Siguiente ›</button>
          </div>
        )}
      </div>
    </div>
  );
}
