import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api';
import type { ReporteRetenciones } from '../tipos';
import { montoSiempre } from '../formato';

const HOY = new Date();
const primerDia = `${HOY.getFullYear()}-${String(HOY.getMonth() + 1).padStart(2, '0')}-01`;
const hoyStr = HOY.toISOString().slice(0, 10);

export default function Retenciones() {
  const [cara, setCara] = useState<'efectuadas' | 'recibidas'>('efectuadas');
  const [desde, setDesde] = useState(primerDia);
  const [hasta, setHasta] = useState(hoyStr);
  const [datos, setDatos] = useState<ReporteRetenciones | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<ReporteRetenciones>(`/retenciones/${cara}?desde=${desde}&hasta=${hasta}`)
      .then((d) => {
        setDatos(d);
        setError('');
      })
      .catch((e) => setError(e instanceof ErrorApi ? e.message : 'Error cargando reporte'));
  }, [cara, desde, hasta]);

  const esEfectuada = cara === 'efectuadas';

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="inline-flex gap-1 bg-white border border-borde rounded-xl p-1">
          <button onClick={() => setCara('efectuadas')}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition ${esEfectuada ? 'bg-tinta text-white' : 'text-slate-500 hover:text-tinta'}`}>
            Efectuadas (a proveedores)
          </button>
          <button onClick={() => setCara('recibidas')}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition ${!esEfectuada ? 'bg-tinta text-white' : 'text-slate-500 hover:text-tinta'}`}>
            Recibidas (nos retienen)
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="entrada max-w-40" />
          <span className="text-slate-400">→</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="entrada max-w-40" />
        </div>
      </div>

      {error && <p className="text-sm text-rojo mb-3">{error}</p>}

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>{esEfectuada ? 'Proveedor' : 'Cliente'}</th>
              <th>RUC</th>
              <th className="text-right">Base</th>
              <th className="text-right">Tasa</th>
              <th className="text-right">Retenido C$</th>
              <th className="text-right">Docs</th>
            </tr>
          </thead>
          <tbody>
            {(!datos || datos.filas.length === 0) && (
              <tr><td colSpan={7} className="py-14 text-center text-slate-400">
                Sin retenciones {esEfectuada ? 'efectuadas' : 'recibidas'} en el período
              </td></tr>
            )}
            {datos?.filas.map((f, i) => (
              <tr key={i}>
                <td className="text-slate-600">{f.tipo_nombre}</td>
                <td className="font-medium">{esEfectuada ? f.proveedor : f.cliente}</td>
                <td className="cifra text-slate-500">{f.ruc ?? '—'}</td>
                <td className="text-right cifra text-slate-500">{montoSiempre(f.base)}</td>
                <td className="text-right cifra text-slate-500">{(Number(f.tasa) * 100).toFixed(2)}%</td>
                <td className="text-right cifra font-medium">{montoSiempre(f.monto)}</td>
                <td className="text-right cifra text-slate-400">{f.documentos}</td>
              </tr>
            ))}
          </tbody>
          {datos && datos.filas.length > 0 && (
            <tfoot className="border-t-2 border-slate-300 font-semibold">
              <tr>
                <td className="px-4 py-2" colSpan={5}>
                  Total {esEfectuada ? 'a declarar/pagar a la DGI' : 'anticipo IR acumulado'}
                </td>
                <td className="px-4 py-2 text-right cifra text-verde-oscuro">{montoSiempre(datos.total)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        {esEfectuada
          ? 'Lo que SEVASA retuvo a sus proveedores en el período — es la base de la declaración mensual de retenciones ante la DGI.'
          : 'Retenciones que nos hicieron (anticipo del IR). SEVASA es gran contribuyente exento, así que normalmente aparece vacío.'}
      </p>
    </div>
  );
}
