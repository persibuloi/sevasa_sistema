import { useEffect, useState, type FormEvent } from 'react';
import { api, ErrorApi } from '../api';
import type { Periodo } from '../tipos';

export default function Periodos() {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [nuevo, setNuevo] = useState('');
  const [aviso, setAviso] = useState('');

  async function cargar() {
    try {
      setPeriodos(await api.get<Periodo[]>('/periodos'));
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error cargando períodos'}`);
    }
  }
  useEffect(() => {
    void cargar();
  }, []);

  async function abrir(e: FormEvent) {
    e.preventDefault();
    setAviso('');
    try {
      await api.post('/periodos', { ano_mes: nuevo });
      setAviso(`✅ Período ${nuevo} abierto`);
      setNuevo('');
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error'}`);
    }
  }

  async function accion(ruta: string, cuerpo?: unknown) {
    setAviso('');
    try {
      await api.post(ruta, cuerpo);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error'}`);
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-semibold text-slate-800 mb-4">Períodos contables</h2>

      <form onSubmit={abrir} className="bg-white rounded-xl shadow p-4 mb-4 flex items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Nuevo período (YYYY-MM)</label>
          <input
            required
            pattern="\d{4}-\d{2}"
            placeholder="2026-08"
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            className="entrada"
          />
        </div>
        <button className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-semibold hover:bg-blue-700">
          Abrir período
        </button>
      </form>

      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Período</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {periodos.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                  Sin períodos — abrí el primero para poder registrar asientos
                </td>
              </tr>
            )}
            {periodos.map((p) => (
              <tr key={p.ano_mes} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono">{p.ano_mes}</td>
                <td className="px-4 py-2">
                  {p.estado === 'abierto' ? (
                    <span className="text-green-700 font-medium">abierto</span>
                  ) : (
                    <span className="text-slate-500">🔒 cerrado</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {p.estado === 'abierto' ? (
                    <button
                      onClick={() => {
                        if (confirm(`¿Cerrar el período ${p.ano_mes}? Quedará inmutable.`)) {
                          void accion(`/periodos/${p.ano_mes}/cerrar`);
                        }
                      }}
                      className="text-amber-700 hover:underline"
                    >
                      Cerrar
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const motivo = prompt(`Motivo para reabrir ${p.ano_mes} (queda en bitácora):`);
                        if (motivo) void accion(`/periodos/${p.ano_mes}/reabrir`, { motivo });
                      }}
                      className="text-blue-600 hover:underline"
                    >
                      Reabrir
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
