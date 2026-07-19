import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api';
import type { Cuenta, RespuestaMayor } from '../tipos';
import { monto, montoSiempre } from '../formato';

export default function Mayor() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cuenta, setCuenta] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [datos, setDatos] = useState<RespuestaMayor | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Cuenta[]>('/cuentas')
      .then((c) => setCuentas(c.filter((x) => x.es_detalle)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!cuenta) {
      setDatos(null);
      return;
    }
    const parametros = new URLSearchParams();
    if (desde) parametros.set('desde', desde);
    if (hasta) parametros.set('hasta', hasta);
    const consulta = parametros.toString();
    api
      .get<RespuestaMayor>(`/mayor/${encodeURIComponent(cuenta)}${consulta ? `?${consulta}` : ''}`)
      .then((d) => {
        setDatos(d);
        setError('');
      })
      .catch((e) => setError(e instanceof ErrorApi ? e.message : 'Error cargando mayor'));
  }, [cuenta, desde, hasta]);

  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-800 mb-4">Libro mayor</h2>

      <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <label className="block text-xs font-medium text-slate-500 mb-1">Cuenta</label>
          <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className="entrada">
            <option value="">— elegir cuenta —</option>
            {cuentas.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.codigo} · {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="entrada" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="entrada" />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {datos && (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Asiento</th>
                <th className="px-4 py-2">Concepto</th>
                <th className="px-4 py-2 text-right">Débito</th>
                <th className="px-4 py-2 text-right">Crédito</th>
                <th className="px-4 py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100 bg-slate-50/50">
                <td className="px-4 py-2 text-slate-500" colSpan={5}>
                  Saldo inicial{datos.desde ? ` al ${datos.desde}` : ''}
                </td>
                <td className="px-4 py-2 text-right font-mono font-semibold">
                  {montoSiempre(datos.saldo_inicial)}
                </td>
              </tr>
              {datos.movimientos.map((m, i) => (
                <tr key={i} className={`border-t border-slate-100 ${m.anulado ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-1.5">{m.fecha.slice(0, 10)}</td>
                  <td className="px-4 py-1.5 font-mono">
                    #{m.asiento_id} <span className="text-slate-400">{m.tipo_origen}</span>
                  </td>
                  <td className="px-4 py-1.5">{m.concepto}</td>
                  <td className="px-4 py-1.5 text-right font-mono">{monto(m.debito)}</td>
                  <td className="px-4 py-1.5 text-right font-mono">{monto(m.credito)}</td>
                  <td className={`px-4 py-1.5 text-right font-mono ${m.saldo < 0 ? 'text-red-700' : ''}`}>
                    {montoSiempre(m.saldo)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 font-semibold">
              <tr>
                <td className="px-4 py-2" colSpan={5}>
                  Saldo final ({datos.movimientos.length} movimientos)
                </td>
                <td className="px-4 py-2 text-right font-mono">{montoSiempre(datos.saldo_final)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
