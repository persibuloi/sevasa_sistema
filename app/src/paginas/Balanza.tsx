import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api';
import type { Periodo, RespuestaBalanza } from '../tipos';
import { monto, montoSiempre } from '../formato';

export default function Balanza() {
  const [datos, setDatos] = useState<RespuestaBalanza | null>(null);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [hasta, setHasta] = useState('');
  const [soloConSaldo, setSoloConSaldo] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Periodo[]>('/periodos').then(setPeriodos).catch(() => undefined);
  }, []);

  useEffect(() => {
    api
      .get<RespuestaBalanza>(`/balanza${hasta ? `?hasta=${hasta}` : ''}`)
      .then((d) => {
        setDatos(d);
        setError('');
      })
      .catch((e) => setError(e instanceof ErrorApi ? e.message : 'Error cargando balanza'));
  }, [hasta]);

  const filas = (datos?.cuentas ?? []).filter(
    (f) => !soloConSaldo || f.debitos !== 0 || f.creditos !== 0
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div />
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-slate-600">
            <input
              type="checkbox"
              checked={soloConSaldo}
              onChange={(e) => setSoloConSaldo(e.target.checked)}
            />
            Solo cuentas con movimiento
          </label>
          <select value={hasta} onChange={(e) => setHasta(e.target.value)} className="entrada">
            <option value="">Todo el historial</option>
            {periodos.map((p) => (
              <option key={p.ano_mes} value={p.ano_mes}>
                hasta {p.ano_mes}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {datos && (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-2">Cuenta</th>
                <th className="px-4 py-2"></th>
                <th className="px-4 py-2 text-right">Débitos</th>
                <th className="px-4 py-2 text-right">Créditos</th>
                <th className="px-4 py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Sin movimientos — la balanza aparecerá al registrar asientos
                  </td>
                </tr>
              )}
              {filas.map((f) => (
                <tr key={f.codigo} className={`border-t border-slate-100 ${f.es_detalle ? '' : 'bg-slate-50/50'}`}>
                  <td
                    className="px-4 py-1.5 font-mono"
                    style={{ paddingLeft: `${1 + (f.nivel - 1) * 1.25}rem` }}
                  >
                    {f.codigo}
                  </td>
                  <td className={`px-4 py-1.5 ${f.es_detalle ? '' : 'font-semibold'}`}>{f.nombre}</td>
                  <td className="px-4 py-1.5 text-right font-mono">{monto(f.debitos)}</td>
                  <td className="px-4 py-1.5 text-right font-mono">{monto(f.creditos)}</td>
                  <td className={`px-4 py-1.5 text-right font-mono ${f.saldo < 0 ? 'text-red-700' : ''}`}>
                    {monto(f.saldo)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 font-semibold">
              <tr>
                <td className="px-4 py-2" colSpan={2}>
                  Totales (cuentas de detalle)
                </td>
                <td className="px-4 py-2 text-right font-mono">{montoSiempre(datos.totales.debitos)}</td>
                <td className="px-4 py-2 text-right font-mono">{montoSiempre(datos.totales.creditos)}</td>
                <td className="px-4 py-2 text-right">
                  {datos.totales.cuadrada ? (
                    <span className="text-green-700">✅ cuadrada</span>
                  ) : (
                    <span className="text-red-600">❌ descuadre</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
