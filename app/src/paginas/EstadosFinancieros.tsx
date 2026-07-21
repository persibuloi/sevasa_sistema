import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ErrorApi } from '../api';
import type { Periodo } from '../tipos';
import { montoSiempre } from '../formato';

const PESTANAS = [
  { clave: 'balance', titulo: 'Balance General' },
  { clave: 'resultados', titulo: 'Estado de Resultados' },
] as const;

type Pestana = (typeof PESTANAS)[number]['clave'];

interface FilaEstado {
  codigo: string;
  nombre: string;
  nivel: number;
  es_detalle: boolean;
  saldo: number;
  anterior?: number;
}

interface Balance {
  hasta: string | null;
  activos: FilaEstado[];
  pasivos: FilaEstado[];
  capital: FilaEstado[];
  totales: {
    activo: number; pasivo: number; capital: number;
    utilidad_periodo: number; pasivo_mas_capital: number; cuadrado: boolean;
  };
}

interface Resultados {
  desde: string; hasta: string;
  anterior: { desde: string; hasta: string };
  ingresos: FilaEstado[]; costos: FilaEstado[]; gastos: FilaEstado[];
  totales: {
    ingresos: number; costos: number; utilidad_bruta: number; gastos: number;
    utilidad_neta: number; margen_neto: number;
    anterior_ingresos: number; anterior_utilidad_neta: number;
  };
}

export default function EstadosFinancieros() {
  const navigate = useNavigate();
  const { pestana: parametro } = useParams();
  const pestana: Pestana = PESTANAS.some((p) => p.clave === parametro) ? (parametro as Pestana) : 'balance';

  return (
    <div className="max-w-5xl">
      <div className="inline-flex gap-1 bg-white border border-borde rounded-xl p-1 mb-5">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            onClick={() => navigate(`/estados/${p.clave}`)}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition ${
              pestana === p.clave ? 'bg-tinta text-white' : 'text-slate-500 hover:text-tinta'
            }`}
          >
            {p.titulo}
          </button>
        ))}
      </div>
      {pestana === 'balance' ? <TabBalance /> : <TabResultados />}
    </div>
  );
}

function Seccion({ titulo, filas, total, comparativo = false }: {
  titulo: string; filas: FilaEstado[]; total: { etiqueta: string; valor: number; anterior?: number };
  comparativo?: boolean;
}) {
  return (
    <tbody>
      <tr className="bg-fondo/70">
        <td colSpan={comparativo ? 3 : 2} className="px-4 py-2 font-bold text-[11px] uppercase tracking-[0.12em] text-slate-500">
          {titulo}
        </td>
      </tr>
      {filas.map((f) => (
        <tr key={f.codigo} className="border-t border-borde/50">
          <td className={`px-4 py-1.5 ${f.es_detalle ? '' : 'font-semibold'}`}
              style={{ paddingLeft: `${1 + (f.nivel - 1) * 1.1}rem` }}>
            <span className="cifra text-slate-400 mr-2">{f.codigo}</span>{f.nombre}
          </td>
          <td className={`px-4 py-1.5 text-right cifra ${f.saldo < 0 ? 'text-rojo' : ''} ${f.es_detalle ? '' : 'font-semibold'}`}>
            {montoSiempre(f.saldo)}
          </td>
          {comparativo && (
            <td className="px-4 py-1.5 text-right cifra text-slate-400">{montoSiempre(f.anterior ?? 0)}</td>
          )}
        </tr>
      ))}
      <tr className="border-t-2 border-slate-300 font-bold">
        <td className="px-4 py-2">{total.etiqueta}</td>
        <td className={`px-4 py-2 text-right cifra ${total.valor < 0 ? 'text-rojo' : ''}`}>{montoSiempre(total.valor)}</td>
        {comparativo && (
          <td className="px-4 py-2 text-right cifra text-slate-400">{montoSiempre(total.anterior ?? 0)}</td>
        )}
      </tr>
    </tbody>
  );
}

function TabBalance() {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [hasta, setHasta] = useState('');
  const [datos, setDatos] = useState<Balance | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Periodo[]>('/periodos').then((p) => {
      setPeriodos(p);
      if (p[0] && !hasta) setHasta(p[0].ano_mes);
    }).catch(() => undefined);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hasta) return;
    api.get<Balance>(`/estados/balance?hasta=${hasta}`)
      .then((d) => { setDatos(d); setError(''); })
      .catch((e) => setError(e instanceof ErrorApi ? e.message : 'Error cargando balance'));
  }, [hasta]);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <select value={hasta} onChange={(e) => setHasta(e.target.value)} className="entrada max-w-44">
          {periodos.map((p) => <option key={p.ano_mes} value={p.ano_mes}>al cierre de {p.ano_mes}</option>)}
        </select>
        {datos && (
          datos.totales.cuadrado
            ? <span className="insignia-verde">✓ Activo = Pasivo + Capital · cuadrado al centavo</span>
            : <span className="insignia-roja">✕ DESCUADRE — revisar asientos</span>
        )}
      </div>
      {error && <p className="text-sm text-rojo mb-3">{error}</p>}

      {datos && (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <div className="tarjeta overflow-hidden">
            <table className="w-full text-sm">
              <Seccion titulo="Activos" filas={datos.activos}
                total={{ etiqueta: 'TOTAL ACTIVO', valor: datos.totales.activo }} />
            </table>
          </div>
          <div className="tarjeta overflow-hidden">
            <table className="w-full text-sm">
              <Seccion titulo="Pasivos" filas={datos.pasivos}
                total={{ etiqueta: 'Total pasivo', valor: datos.totales.pasivo }} />
              <Seccion titulo="Capital" filas={datos.capital}
                total={{ etiqueta: 'Total capital', valor: datos.totales.capital }} />
              <tbody>
                <tr className="border-t border-borde/50">
                  <td className="px-4 py-1.5 italic text-slate-500">Utilidad (pérdida) del período sin cerrar</td>
                  <td className={`px-4 py-1.5 text-right cifra ${datos.totales.utilidad_periodo < 0 ? 'text-rojo' : 'text-verde-oscuro'}`}>
                    {montoSiempre(datos.totales.utilidad_periodo)}
                  </td>
                </tr>
                <tr className="border-t-2 border-slate-300 font-bold">
                  <td className="px-4 py-2">TOTAL PASIVO + CAPITAL</td>
                  <td className="px-4 py-2 text-right cifra">{montoSiempre(datos.totales.pasivo_mas_capital)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TabResultados() {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [datos, setDatos] = useState<Resultados | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    api.get<Periodo[]>('/periodos').then((p) => {
      setPeriodos(p);
      if (p[0]) { setDesde(p[0].ano_mes); setHasta(p[0].ano_mes); }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!desde || !hasta) return;
    api.get<Resultados>(`/estados/resultados?desde=${desde}&hasta=${hasta}`)
      .then((d) => { setDatos(d); setError(''); })
      .catch((e) => setError(e instanceof ErrorApi ? e.message : 'Error cargando resultados'));
  }, [desde, hasta]);

  async function cerrarEjercicio() {
    if (!hasta) return;
    if (!confirm(`¿CERRAR EL EJERCICIO al ${hasta}? Salda TODAS las cuentas de ingresos, costos y gastos contra resultados acumulados. Es el paso de fin de año — se revierte solo anulando el asiento de cierre.`)) return;
    if (!confirm('Segunda confirmación: esta acción genera el asiento de cierre. ¿Continuar?')) return;
    setAviso('');
    try {
      const r = await api.post<{ asiento_id: number; utilidad: number }>('/estados/cerrar', { hasta });
      setAviso(`✅ Ejercicio cerrado — asiento #${r.asiento_id}, resultado trasladado: C$ ${montoSiempre(r.utilidad)}`);
      setDesde(hasta); setHasta(hasta);
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al cerrar'}`);
    }
  }

  const variacion = (actual: number, anterior: number) =>
    anterior !== 0 ? ((actual - anterior) / Math.abs(anterior)) * 100 : null;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <select value={desde} onChange={(e) => setDesde(e.target.value)} className="entrada max-w-36">
            {periodos.map((p) => <option key={p.ano_mes} value={p.ano_mes}>{p.ano_mes}</option>)}
          </select>
          <span className="text-slate-400">→</span>
          <select value={hasta} onChange={(e) => setHasta(e.target.value)} className="entrada max-w-36">
            {periodos.map((p) => <option key={p.ano_mes} value={p.ano_mes}>{p.ano_mes}</option>)}
          </select>
        </div>
        <button onClick={() => void cerrarEjercicio()} className="boton-peligro text-sm">
          Cerrar ejercicio…
        </button>
      </div>
      {error && <p className="text-sm text-rojo mb-3">{error}</p>}
      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {datos && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="tarjeta px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Ingresos</div>
              <div className="cifra text-lg font-bold mt-1">{montoSiempre(datos.totales.ingresos)}</div>
              {variacion(datos.totales.ingresos, datos.totales.anterior_ingresos) !== null && (
                <div className={`text-[11px] cifra ${datos.totales.ingresos >= datos.totales.anterior_ingresos ? 'text-verde-oscuro' : 'text-rojo'}`}>
                  {variacion(datos.totales.ingresos, datos.totales.anterior_ingresos)!.toFixed(1)}% vs período anterior
                </div>
              )}
            </div>
            <div className="tarjeta px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Utilidad bruta</div>
              <div className="cifra text-lg font-bold mt-1">{montoSiempre(datos.totales.utilidad_bruta)}</div>
            </div>
            <div className="tarjeta px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Utilidad neta</div>
              <div className={`cifra text-lg font-bold mt-1 ${datos.totales.utilidad_neta < 0 ? 'text-rojo' : 'text-verde-oscuro'}`}>
                {montoSiempre(datos.totales.utilidad_neta)}
              </div>
            </div>
            <div className="tarjeta px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Margen neto</div>
              <div className="cifra text-lg font-bold mt-1">{(datos.totales.margen_neto * 100).toFixed(1)}%</div>
            </div>
          </div>

          <div className="tarjeta overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 text-left border-b border-borde">
                  <th className="px-4 py-2">Cuenta</th>
                  <th className="px-4 py-2 text-right">{datos.desde === datos.hasta ? datos.hasta : `${datos.desde} → ${datos.hasta}`}</th>
                  <th className="px-4 py-2 text-right">{datos.anterior.desde === datos.anterior.hasta ? datos.anterior.hasta : `${datos.anterior.desde} → ${datos.anterior.hasta}`}</th>
                </tr>
              </thead>
              <Seccion titulo="Ingresos" filas={datos.ingresos} comparativo
                total={{ etiqueta: 'Total ingresos', valor: datos.totales.ingresos, anterior: datos.totales.anterior_ingresos }} />
              <Seccion titulo="Costos" filas={datos.costos} comparativo
                total={{ etiqueta: 'Utilidad bruta', valor: datos.totales.utilidad_bruta }} />
              <Seccion titulo="Gastos" filas={datos.gastos} comparativo
                total={{ etiqueta: 'UTILIDAD NETA', valor: datos.totales.utilidad_neta, anterior: datos.totales.anterior_utilidad_neta }} />
            </table>
          </div>
        </>
      )}
    </div>
  );
}
