import { useEffect, useState, type FormEvent } from 'react';
import { api, ErrorApi } from '../api';
import type { Cuenta, TipoCuenta } from '../tipos';

const TIPOS: TipoCuenta[] = ['activo', 'pasivo', 'capital', 'ingreso', 'costo', 'gasto'];

const FORMULARIO_VACIO = {
  codigo: '',
  nombre: '',
  tipo: 'activo' as TipoCuenta,
  padre: '',
  nivel: 1,
  es_detalle: true,
  moneda: 'NIO' as 'NIO' | 'USD',
  activa: true,
};

export default function Catalogo() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [editando, setEditando] = useState<string | null>(null); // codigo en edición, '' = nueva
  const [form, setForm] = useState(FORMULARIO_VACIO);

  async function cargar() {
    try {
      setCuentas(await api.get<Cuenta[]>('/cuentas'));
      setError('');
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'Error cargando catálogo');
    }
  }
  useEffect(() => {
    void cargar();
  }, []);

  function abrirNueva() {
    setForm(FORMULARIO_VACIO);
    setEditando('');
    setAviso('');
  }

  function abrirEdicion(c: Cuenta) {
    setForm({
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      padre: c.padre ?? '',
      nivel: c.nivel,
      es_detalle: c.es_detalle,
      moneda: c.moneda,
      activa: c.activa,
    });
    setEditando(c.codigo);
    setAviso('');
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setAviso('');
    const datos = { ...form, padre: form.padre || null };
    try {
      if (editando === '') {
        await api.post('/cuentas', datos);
        setAviso(`✅ Cuenta ${form.codigo} creada`);
      } else {
        await api.put(`/cuentas/${encodeURIComponent(form.codigo)}`, datos);
        setAviso(`✅ Cuenta ${form.codigo} actualizada`);
      }
      setEditando(null);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al guardar'}`);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-slate-800">Catálogo de cuentas</h2>
        <button
          onClick={abrirNueva}
          className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-semibold hover:bg-blue-700"
        >
          + Nueva cuenta
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {editando !== null && (
        <form onSubmit={guardar} className="bg-white rounded-xl shadow p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <Campo etiqueta="Código">
            <input
              required
              disabled={editando !== ''}
              value={form.codigo}
              onChange={(e) => setForm({ ...form, codigo: e.target.value })}
              className="entrada"
            />
          </Campo>
          <Campo etiqueta="Nombre">
            <input
              required
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              className="entrada"
            />
          </Campo>
          <Campo etiqueta="Tipo">
            <select
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoCuenta })}
              className="entrada"
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Cuenta padre">
            <select
              value={form.padre}
              onChange={(e) => {
                const padre = e.target.value;
                const cp = cuentas.find((c) => c.codigo === padre);
                setForm({ ...form, padre, nivel: cp ? cp.nivel + 1 : 1 });
              }}
              className="entrada"
            >
              <option value="">— ninguna (nivel 1) —</option>
              {cuentas
                .filter((c) => c.codigo !== form.codigo)
                .map((c) => (
                  <option key={c.codigo} value={c.codigo}>
                    {c.codigo} · {c.nombre}
                  </option>
                ))}
            </select>
          </Campo>
          <Campo etiqueta="Moneda">
            <select
              value={form.moneda}
              onChange={(e) => setForm({ ...form, moneda: e.target.value as 'NIO' | 'USD' })}
              className="entrada"
            >
              <option value="NIO">NIO (córdobas)</option>
              <option value="USD">USD (dólares)</option>
            </select>
          </Campo>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.es_detalle}
              onChange={(e) => setForm({ ...form, es_detalle: e.target.checked })}
            />
            De detalle (recibe movimientos)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.activa}
              onChange={(e) => setForm({ ...form, activa: e.target.checked })}
            />
            Activa
          </label>
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-semibold hover:bg-blue-700">
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setEditando(null)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Moneda</th>
              <th className="px-4 py-2">Detalle</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {cuentas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Catálogo vacío — creá cuentas o esperá el importador desde el sistema viejo
                </td>
              </tr>
            )}
            {cuentas.map((c) => (
              <tr key={c.codigo} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 font-mono" style={{ paddingLeft: `${1 + (c.nivel - 1) * 1.25}rem` }}>
                  {c.codigo}
                </td>
                <td className={`px-4 py-2 ${c.es_detalle ? '' : 'font-semibold'}`}>{c.nombre}</td>
                <td className="px-4 py-2 text-slate-500">{c.tipo}</td>
                <td className="px-4 py-2 text-slate-500">{c.moneda}</td>
                <td className="px-4 py-2">{c.es_detalle ? 'Sí' : 'Mayor'}</td>
                <td className="px-4 py-2">
                  {c.activa ? (
                    <span className="text-green-700">activa</span>
                  ) : (
                    <span className="text-slate-400">inactiva</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => abrirEdicion(c)} className="text-blue-600 hover:underline">
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

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{etiqueta}</label>
      {children}
    </div>
  );
}
