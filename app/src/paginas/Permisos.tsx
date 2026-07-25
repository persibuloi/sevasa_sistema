import { useEffect, useMemo, useState } from 'react';
import { api, ErrorApi } from '../api';

/** Matriz rol → módulo → acción. Un clic prende o apaga la celda; aplica en
 *  el ACTO en el backend (cada petición revisa la tabla) y el menú del
 *  usuario se acomoda cuando recarga. El rol admin pasa todo por diseño. */

interface Matriz {
  roles: string[];
  modulos: string[];
  acciones: string[];
  permisos: Array<{ rol: string; modulo: string; accion: string }>;
}

const NOMBRE_MODULO: Record<string, string> = {
  contabilidad: 'Contabilidad',
  facturacion: 'Facturación',
  compras: 'Compras',
  cxc: 'Cobranza (CxC)',
  bancos: 'Bancos',
  polizas: 'Pólizas',
  inventario: 'Inventario',
  admin: 'Administración',
};

const NOMBRE_ROL: Record<string, string> = {
  contador: 'Contador',
  cajero: 'Cajero',
  facturador: 'Facturador',
  comprador: 'Comprador',
  consulta: 'Consulta',
};

const PISTA_ACCION: Record<string, string> = {
  ver: 'entra a las pantallas del módulo',
  crear: 'registra documentos nuevos',
  editar: 'modifica borradores y catálogos',
  anular: 'anula documentos emitidos',
  cerrar: 'cierres y conciliaciones',
};

export default function Permisos() {
  const [matriz, setMatriz] = useState<Matriz | null>(null);
  const [rol, setRol] = useState('facturador');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    api.get<Matriz>('/permisos').then(setMatriz).catch(() => setAviso('❌ Error cargando la matriz'));
  }, []);

  const activos = useMemo(() => {
    const s = new Set<string>();
    for (const p of matriz?.permisos ?? []) s.add(`${p.rol}|${p.modulo}|${p.accion}`);
    return s;
  }, [matriz]);

  async function alternar(modulo: string, accion: string) {
    if (!matriz) return;
    const llave = `${rol}|${modulo}|${accion}`;
    const permitido = !activos.has(llave);
    // pintar de una (optimista) y confirmar contra el backend
    setMatriz({
      ...matriz,
      permisos: permitido
        ? [...matriz.permisos, { rol, modulo, accion }]
        : matriz.permisos.filter((p) => !(p.rol === rol && p.modulo === modulo && p.accion === accion)),
    });
    try {
      await api.put('/permisos', { rol, modulo, accion, permitido });
      setAviso('');
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'No se pudo guardar'} — recargá la página`);
    }
  }

  if (!matriz) return <p className="text-sm text-slate-400">{aviso || 'Cargando…'}</p>;

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-xl border border-borde bg-white p-1">
          {matriz.roles.map((r) => (
            <button
              key={r}
              onClick={() => setRol(r)}
              className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition ${
                rol === r ? 'bg-tinta text-white' : 'text-slate-500 hover:text-tinta'
              }`}
            >
              {NOMBRE_ROL[r] ?? r}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">
          El rol <strong>admin</strong> pasa todo y no se toca (nadie puede dejarse fuera).
        </span>
      </div>

      {aviso && <p className="mb-3 text-sm">{aviso}</p>}

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Módulo</th>
              {matriz.acciones.map((a) => (
                <th key={a} className="text-center capitalize" title={PISTA_ACCION[a]}>{a}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matriz.modulos.map((m) => (
              <tr key={m}>
                <td className="font-medium">{NOMBRE_MODULO[m] ?? m}</td>
                {matriz.acciones.map((a) => {
                  const encendido = activos.has(`${rol}|${m}|${a}`);
                  return (
                    <td key={a} className="text-center">
                      <button
                        onClick={() => void alternar(m, a)}
                        title={`${NOMBRE_ROL[rol] ?? rol} · ${NOMBRE_MODULO[m] ?? m} · ${a}`}
                        className={`h-7 w-7 rounded-lg border text-[13px] font-bold transition ${
                          encendido
                            ? 'border-verde bg-verde text-white'
                            : 'border-borde bg-white text-transparent hover:border-slate-300 hover:text-slate-200'
                        }`}
                      >
                        ✓
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-1 text-xs leading-relaxed text-slate-400">
        <p>
          <strong className="text-slate-500">ver</strong> también decide qué aparece en el MENÚ de ese usuario
          (se acomoda al recargar la página). Sin «ver», el módulo desaparece y el backend rechaza sus rutas.
        </p>
        <p>
          El costo de los productos solo lo ve quien tenga <strong className="text-slate-500">Inventario · ver</strong> —
          un facturador ve precios y existencias, nunca costos.
        </p>
        <p>Cada cambio queda en bitácora.</p>
      </div>
    </div>
  );
}
