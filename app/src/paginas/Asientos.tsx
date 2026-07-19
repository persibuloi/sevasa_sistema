import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ErrorApi } from '../api';
import type { Asiento, Cuenta } from '../tipos';
import { monto, montoSiempre } from '../formato';

interface LineaForm {
  cuenta: string;
  debito: string;
  credito: string;
}

const LINEA_VACIA: LineaForm = { cuenta: '', debito: '', credito: '' };

export default function Asientos() {
  const [asientos, setAsientos] = useState<Asiento[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [aviso, setAviso] = useState('');
  const [mostrandoForm, setMostrandoForm] = useState(false);

  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [concepto, setConcepto] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([{ ...LINEA_VACIA }, { ...LINEA_VACIA }]);

  const detalle = useMemo(() => cuentas.filter((c) => c.es_detalle && c.activa), [cuentas]);

  const totales = useMemo(() => {
    let d = 0;
    let c = 0;
    for (const l of lineas) {
      d += Math.round(Number(l.debito || 0) * 100);
      c += Math.round(Number(l.credito || 0) * 100);
    }
    return { debitos: d / 100, creditos: c / 100, cuadra: d === c && d > 0 };
  }, [lineas]);

  async function cargar() {
    try {
      const [a, c] = await Promise.all([api.get<Asiento[]>('/asientos'), api.get<Cuenta[]>('/cuentas')]);
      setAsientos(a);
      setCuentas(c);
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error cargando asientos'}`);
    }
  }
  useEffect(() => {
    void cargar();
  }, []);

  function cambiarLinea(indice: number, cambio: Partial<LineaForm>) {
    setLineas((previas) => previas.map((l, i) => (i === indice ? { ...l, ...cambio } : l)));
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setAviso('');
    try {
      await api.post('/asientos', {
        fecha,
        concepto,
        movimientos: lineas
          .filter((l) => l.cuenta)
          .map((l) => ({
            cuenta: l.cuenta,
            debito: Number(l.debito || 0),
            credito: Number(l.credito || 0),
          })),
      });
      setAviso('✅ Asiento registrado');
      setConcepto('');
      setLineas([{ ...LINEA_VACIA }, { ...LINEA_VACIA }]);
      setMostrandoForm(false);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al guardar'}`);
    }
  }

  async function anular(id: number) {
    const motivo = prompt(`Motivo para anular el asiento #${id} (queda en bitácora):`);
    if (!motivo) return;
    setAviso('');
    try {
      await api.post(`/asientos/${id}/anular`, { motivo });
      setAviso(`✅ Asiento #${id} anulado con contra-asiento`);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al anular'}`);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div />
        <button
          onClick={() => setMostrandoForm(!mostrandoForm)}
          className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-semibold hover:bg-blue-700"
        >
          {mostrandoForm ? 'Ocultar formulario' : '+ Asiento manual'}
        </button>
      </div>

      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {mostrandoForm && (
        <form onSubmit={guardar} className="bg-white rounded-xl shadow p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Fecha</label>
              <input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} className="entrada" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Concepto</label>
              <input
                required
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                placeholder="Ajuste por…"
                className="entrada"
              />
            </div>
          </div>

          <table className="w-full text-sm mb-2">
            <thead className="text-slate-500 text-left">
              <tr>
                <th className="py-1 pr-2">Cuenta</th>
                <th className="py-1 pr-2 w-36">Débito</th>
                <th className="py-1 pr-2 w-36">Crédito</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <select
                      value={l.cuenta}
                      onChange={(e) => cambiarLinea(i, { cuenta: e.target.value })}
                      className="entrada"
                    >
                      <option value="">— cuenta —</option>
                      {detalle.map((c) => (
                        <option key={c.codigo} value={c.codigo}>
                          {c.codigo} · {c.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.debito}
                      onChange={(e) => cambiarLinea(i, { debito: e.target.value, credito: '' })}
                      className="entrada text-right"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.credito}
                      onChange={(e) => cambiarLinea(i, { credito: e.target.value, debito: '' })}
                      className="entrada text-right"
                    />
                  </td>
                  <td>
                    {lineas.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setLineas(lineas.filter((_, j) => j !== i))}
                        className="text-slate-400 hover:text-red-600"
                        title="Quitar línea"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setLineas([...lineas, { ...LINEA_VACIA }])}
              className="text-sm text-blue-600 hover:underline"
            >
              + Agregar línea
            </button>
            <div className="flex items-center gap-4 text-sm">
              <span>
                Débitos: <strong>{montoSiempre(totales.debitos)}</strong>
              </span>
              <span>
                Créditos: <strong>{montoSiempre(totales.creditos)}</strong>
              </span>
              {totales.cuadra ? (
                <span className="text-green-700 font-semibold">✅ cuadra</span>
              ) : (
                <span className="text-red-600 font-semibold">descuadrado</span>
              )}
              <button
                type="submit"
                disabled={!totales.cuadra}
                className="rounded-lg bg-blue-600 text-white px-4 py-2 font-semibold hover:bg-blue-700 disabled:opacity-40"
              >
                Registrar asiento
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Origen</th>
              <th className="px-4 py-2">Concepto</th>
              <th className="px-4 py-2 text-right">Monto</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {asientos.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Sin asientos todavía
                </td>
              </tr>
            )}
            {asientos.map((a) => {
              const total = a.movimientos.reduce((s, m) => s + Number(m.debito), 0);
              return (
                <tr key={a.id} className={`border-t border-slate-100 ${a.anulado ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2 font-mono">{a.id}</td>
                  <td className="px-4 py-2">{a.fecha.slice(0, 10)}</td>
                  <td className="px-4 py-2 text-slate-500">{a.tipo_origen}</td>
                  <td className="px-4 py-2">{a.concepto}</td>
                  <td className="px-4 py-2 text-right font-mono">{monto(total)}</td>
                  <td className="px-4 py-2">
                    {a.anulado ? (
                      <span className="text-red-600">anulado (#{a.anulado_por})</span>
                    ) : (
                      <span className="text-green-700">vigente</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {!a.anulado && a.tipo_origen !== 'contra_asiento' && (
                      <button onClick={() => void anular(a.id)} className="text-red-600 hover:underline">
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
