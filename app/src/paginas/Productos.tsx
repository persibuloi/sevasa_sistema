import { useEffect, useMemo, useState, type FormEvent } from 'react';
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

export default function Productos() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [form, setForm] = useState<typeof FORM_VACIO | null>(null);
  const [aviso, setAviso] = useState('');

  async function cargar() {
    try {
      setProductos(await api.get<Producto[]>('/productos'));
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error cargando productos'}`);
    }
  }
  useEffect(() => {
    void cargar();
  }, []);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) ||
        p.codigo.toLowerCase().includes(q) ||
        (p.categoria ?? '').toLowerCase().includes(q)
    );
  }, [productos, busqueda]);

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
        <button onClick={() => setForm({ ...FORM_VACIO })} className="boton-primario">
          + Nuevo producto
        </button>
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
              <th className="text-right">Precio C$</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={7} className="py-14 text-center text-slate-400">
                  {busqueda ? 'Sin resultados' : 'Sin productos — creá el primero'}
                </td>
              </tr>
            )}
            {filtrados.map((p) => (
              <tr key={p.id}>
                <td className="cifra font-medium">{p.codigo}</td>
                <td className="font-medium">{p.nombre}</td>
                <td className="text-slate-500">{p.categoria ?? '—'}</td>
                <td className="text-slate-500">{p.unidad}</td>
                <td className="text-right cifra font-medium">{montoSiempre(p.precio_venta)}</td>
                <td>
                  {p.activo ? <span className="insignia-verde">activo</span> : <span className="insignia-gris">inactivo</span>}
                </td>
                <td className="text-right">
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
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Lista de precios sin inventario: las existencias y el costo de venta llegan en su propia fase.
        Los cambios de precio quedan en bitácora.
      </p>
    </div>
  );
}
