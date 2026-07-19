import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ErrorApi } from '../api';
import type { Cliente } from '../tipos';

const FORM_VACIO = { id: null as number | null, nombre: '', ruc: '', terminos_dias: '0', activo: true };

export default function Clientes() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [form, setForm] = useState<typeof FORM_VACIO | null>(null);
  const [aviso, setAviso] = useState('');

  async function cargar() {
    try {
      setClientes(await api.get<Cliente[]>('/clientes'));
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error cargando clientes'}`);
    }
  }
  useEffect(() => {
    void cargar();
  }, []);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter(
      (c) => c.nombre.toLowerCase().includes(q) || (c.ruc ?? '').toLowerCase().includes(q)
    );
  }, [clientes, busqueda]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setAviso('');
    const datos = {
      nombre: form.nombre,
      ruc: form.ruc || null,
      terminos_dias: Number(form.terminos_dias || 0),
      activo: form.activo,
    };
    try {
      if (form.id === null) {
        await api.post('/clientes', datos);
        setAviso(`✅ Cliente "${form.nombre}" creado`);
      } else {
        await api.put(`/clientes/${form.id}`, datos);
        setAviso(`✅ Cliente "${form.nombre}" actualizado`);
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
          placeholder="Buscar por nombre o RUC…"
          className="entrada max-w-xs"
        />
        <button onClick={() => setForm({ ...FORM_VACIO })} className="boton-primario">
          + Nuevo cliente
        </button>
      </div>

      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {form && (
        <form onSubmit={guardar} className="tarjeta p-6 mb-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="etiqueta">Nombre o razón social</label>
              <input
                required
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder="Comercial El Progreso S.A."
                className="entrada"
              />
            </div>
            <div>
              <label className="etiqueta">RUC / Cédula</label>
              <input
                value={form.ruc}
                onChange={(e) => setForm({ ...form, ruc: e.target.value })}
                placeholder="J031…"
                className="entrada cifra"
              />
            </div>
            <div>
              <label className="etiqueta">Términos de crédito (días)</label>
              <input
                type="number"
                min="0"
                value={form.terminos_dias}
                onChange={(e) => setForm({ ...form, terminos_dias: e.target.value })}
                className="entrada text-right"
              />
            </div>
            <label className="flex items-end gap-2 text-sm text-slate-600 pb-2">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(e) => setForm({ ...form, activo: e.target.checked })}
              />
              Cliente activo
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
              <th>Cliente</th>
              <th>RUC / Cédula</th>
              <th className="text-right">Crédito</th>
              <th className="text-right">Facturas</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={6} className="py-14 text-center text-slate-400">
                  {busqueda ? 'Sin resultados para la búsqueda' : 'Sin clientes — creá el primero'}
                </td>
              </tr>
            )}
            {filtrados.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.nombre}</td>
                <td className="cifra text-slate-500">{c.ruc ?? '—'}</td>
                <td className="text-right text-slate-500">
                  {c.terminos_dias > 0 ? `${c.terminos_dias} días` : 'contado'}
                </td>
                <td className="text-right cifra">{c.facturas_emitidas ?? 0}</td>
                <td>
                  {c.activo ? (
                    <span className="insignia-verde">activo</span>
                  ) : (
                    <span className="insignia-gris">inactivo</span>
                  )}
                </td>
                <td className="text-right">
                  <button
                    onClick={() =>
                      setForm({
                        id: c.id,
                        nombre: c.nombre,
                        ruc: c.ruc ?? '',
                        terminos_dias: String(c.terminos_dias),
                        activo: c.activo,
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
    </div>
  );
}
