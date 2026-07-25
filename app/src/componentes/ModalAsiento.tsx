import { useEffect, useState } from 'react';
import { api } from '../api';
import { montoSiempre } from '../formato';

/** Modal con el detalle de un asiento: débitos y créditos cuenta por cuenta
 *  (y el contra-asiento si está anulado). Vive en Contabilidad → Asientos —
 *  el detalle contable se consulta en contabilidad, no en el documento. */

interface MovimientoAsiento {
  id: number;
  cuenta: string;
  cuenta_nombre: string | null;
  debito: string | number;
  credito: string | number;
  documento_ref: string | null;
}

interface AsientoCompleto {
  id: number;
  fecha: string;
  tipo_origen: string;
  concepto: string;
  anulado: boolean;
  anulado_por: number | null;
  movimientos: MovimientoAsiento[];
}

function TablaAsiento({ asiento, titulo }: { asiento: AsientoCompleto; titulo: string }) {
  const debitos = asiento.movimientos.reduce((t, m) => t + Math.round(Number(m.debito) * 100), 0) / 100;
  const creditos = asiento.movimientos.reduce((t, m) => t + Math.round(Number(m.credito) * 100), 0) / 100;
  return (
    <div className="border-b border-borde last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 px-5 py-3">
        <div>
          <span className="rotulo">{titulo}</span>
          <div className="text-[14px] font-bold text-tinta">
            Asiento #{asiento.id}
            <span className="ml-2 font-normal text-slate-400">
              {asiento.fecha.slice(0, 10)} · {asiento.tipo_origen} · {asiento.concepto}
            </span>
          </div>
        </div>
        {asiento.anulado && <span className="insignia-roja">anulado</span>}
      </div>
      <table className="tabla">
        <thead>
          <tr>
            <th>Cuenta</th>
            <th>Nombre</th>
            <th className="text-right">Débito</th>
            <th className="text-right">Crédito</th>
          </tr>
        </thead>
        <tbody>
          {asiento.movimientos.map((m) => (
            <tr key={m.id}>
              <td className="cifra text-slate-500">{m.cuenta}</td>
              <td className="font-medium">{m.cuenta_nombre ?? '—'}</td>
              <td className="text-right cifra">{Number(m.debito) > 0 ? montoSiempre(m.debito) : ''}</td>
              <td className="text-right cifra">{Number(m.credito) > 0 ? montoSiempre(m.credito) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-borde bg-slate-50/70">
            <td colSpan={2} className="px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
              Sumas iguales
            </td>
            <td className="px-4 py-2.5 text-right cifra font-bold text-tinta">{montoSiempre(debitos)}</td>
            <td className="px-4 py-2.5 text-right cifra font-bold text-tinta">{montoSiempre(creditos)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function ModalAsiento({ asientoId, alCerrar }: { asientoId: number; alCerrar: () => void }) {
  const [asiento, setAsiento] = useState<AsientoCompleto | null>(null);
  const [contra, setContra] = useState<AsientoCompleto | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setAsiento(null);
    setContra(null);
    api.get<AsientoCompleto>(`/asientos/${asientoId}`)
      .then((a) => {
        setAsiento(a);
        if (a.anulado_por) {
          api.get<AsientoCompleto>(`/asientos/${a.anulado_por}`).then(setContra).catch(() => undefined);
        }
      })
      .catch(() => setError('No se pudo cargar el asiento'));
  }, [asientoId]);

  useEffect(() => {
    const conEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar(); };
    window.addEventListener('keydown', conEsc);
    return () => window.removeEventListener('keydown', conEsc);
  }, [alCerrar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-tinta/50 p-4 pt-[8vh] backdrop-blur-[2px]"
      onClick={alCerrar}
    >
      <div
        className="max-h-[84vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-borde bg-white shadow-[0_24px_64px_rgba(14,22,34,0.28)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-borde px-5 py-3">
          <h3 className="font-bold text-tinta">Detalle del asiento</h3>
          <button
            onClick={alCerrar}
            className="h-8 w-8 rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-tinta"
          >
            ✕
          </button>
        </div>
        {error && <p className="p-5 text-sm text-rojo">{error}</p>}
        {!asiento && !error && <p className="p-5 text-sm text-slate-400">Cargando…</p>}
        {asiento && <TablaAsiento asiento={asiento} titulo="Asiento" />}
        {contra && <TablaAsiento asiento={contra} titulo="Contra-asiento de la anulación" />}
      </div>
    </div>
  );
}
