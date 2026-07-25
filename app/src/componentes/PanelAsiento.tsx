import { useEffect, useState } from 'react';
import { api } from '../api';
import { montoSiempre } from '../formato';

/** El detalle transaccional de un documento: su asiento con débitos y
 *  créditos cuenta por cuenta (y el contra-asiento si está anulado).
 *  Exige permiso contabilidad/ver — si el backend lo niega (403), el panel
 *  simplemente no aparece: un facturador no ve el costo de venta. */

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
    <div className="tarjeta mt-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-borde px-5 py-3">
        <div>
          <span className="rotulo">{titulo}</span>
          <div className="text-[14px] font-bold text-tinta">
            Asiento #{asiento.id}
            <span className="ml-2 font-normal text-slate-400">
              {asiento.fecha.slice(0, 10)} · {asiento.concepto}
            </span>
          </div>
        </div>
        {asiento.anulado && <span className="insignia-roja">anulado</span>}
      </div>
      <div className="overflow-x-auto">
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
    </div>
  );
}

export default function PanelAsiento({ asientoId }: { asientoId: number }) {
  const [asiento, setAsiento] = useState<AsientoCompleto | null>(null);
  const [contra, setContra] = useState<AsientoCompleto | null>(null);

  useEffect(() => {
    setAsiento(null);
    setContra(null);
    api.get<AsientoCompleto>(`/asientos/${asientoId}`)
      .then((a) => {
        setAsiento(a);
        // Si está anulado, el contra-asiento cuenta la otra mitad de la historia
        if (a.anulado_por) {
          api.get<AsientoCompleto>(`/asientos/${a.anulado_por}`).then(setContra).catch(() => undefined);
        }
      })
      .catch(() => setAsiento(null)); // sin permiso de contabilidad: no se muestra
  }, [asientoId]);

  if (!asiento) return null;
  return (
    <div>
      <TablaAsiento asiento={asiento} titulo="Detalle contable del documento" />
      {contra && <TablaAsiento asiento={contra} titulo="Contra-asiento de la anulación" />}
    </div>
  );
}
