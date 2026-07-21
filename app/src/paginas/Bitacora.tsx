import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api';

interface FilaBitacora {
  id: number;
  en: string;
  accion: string;
  entidad: string | null;
  entidad_id: string | null;
  detalle: Record<string, unknown> | null;
  usuario: string | null;
  email: string | null;
}

const POR_PAGINA = 50;

function ColorAccion({ accion }: { accion: string }) {
  const clase = accion.startsWith('anular') || accion.startsWith('desconciliar')
    ? 'insignia-roja'
    : accion.startsWith('cerrar') || accion.startsWith('reabrir')
    ? 'insignia-ambar'
    : accion.startsWith('editar') || accion.startsWith('crear')
    ? 'insignia-gris'
    : 'insignia-verde';
  return <span className={clase}>{accion.replaceAll('_', ' ')}</span>;
}

export default function Bitacora() {
  const [filas, setFilas] = useState<FilaBitacora[]>([]);
  const [total, setTotal] = useState(0);
  const [acciones, setAcciones] = useState<string[]>([]);
  const [usuarios, setUsuarios] = useState<Array<{ id: string; nombre: string }>>([]);
  const [busqueda, setBusqueda] = useState('');
  const [usuario, setUsuario] = useState('');
  const [accion, setAccion] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(1);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [error, setError] = useState('');

  const totalPaginas = Math.max(Math.ceil(total / POR_PAGINA), 1);

  useEffect(() => {
    api.get<{ acciones: string[]; usuarios: Array<{ id: string; nombre: string }> }>('/bitacora/filtros')
      .then((f) => { setAcciones(f.acciones); setUsuarios(f.usuarios); })
      .catch(() => undefined);
  }, []);

  useEffect(() => { setPagina(1); }, [busqueda, usuario, accion, desde, hasta]);

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (busqueda.trim()) p.set('q', busqueda.trim());
      if (usuario) p.set('usuario', usuario);
      if (accion) p.set('accion', accion);
      if (desde) p.set('desde', desde);
      if (hasta) p.set('hasta', hasta);
      p.set('pagina', String(pagina));
      p.set('por_pagina', String(POR_PAGINA));
      api.get<{ filas: FilaBitacora[]; total: number }>(`/bitacora?${p.toString()}`)
        .then((d) => { setFilas(d.filas); setTotal(d.total); setError(''); })
        .catch((e) => setError(e instanceof ErrorApi ? e.message : 'Error cargando bitácora'));
    }, busqueda ? 300 : 0);
    return () => clearTimeout(t);
  }, [busqueda, usuario, accion, desde, hasta, pagina]);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar en acción, entidad o detalle…" className="entrada max-w-64" />
        <select value={usuario} onChange={(e) => setUsuario(e.target.value)} className="entrada max-w-52">
          <option value="">Todos los usuarios</option>
          {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        <select value={accion} onChange={(e) => setAccion(e.target.value)} className="entrada max-w-56">
          <option value="">Todas las acciones</option>
          {acciones.map((a) => <option key={a} value={a}>{a.replaceAll('_', ' ')}</option>)}
        </select>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="entrada max-w-36" title="Desde" />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="entrada max-w-36" title="Hasta" />
      </div>
      {error && <p className="text-sm text-rojo mb-3">{error}</p>}

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Sobre</th><th>Detalle</th></tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr><td colSpan={5} className="py-14 text-center text-slate-400">Sin registros con esos filtros</td></tr>
            )}
            {filas.map((f) => (
              <tr key={f.id} onClick={() => setAbierta(abierta === f.id ? null : f.id)} className="cursor-pointer align-top">
                <td className="cifra whitespace-nowrap">{f.en.slice(0, 10)} <span className="text-slate-400">{f.en.slice(11, 19)}</span></td>
                <td className="font-medium whitespace-nowrap" title={f.email ?? ''}>{f.usuario ?? '—'}</td>
                <td><ColorAccion accion={f.accion} /></td>
                <td className="text-slate-500 whitespace-nowrap">
                  {f.entidad ?? '—'}{f.entidad_id ? <span className="cifra"> #{f.entidad_id}</span> : ''}
                </td>
                <td className="text-slate-500 max-w-md">
                  {f.detalle ? (
                    abierta === f.id ? (
                      <pre className="cifra text-[11px] whitespace-pre-wrap break-all bg-fondo rounded p-2">
                        {JSON.stringify(f.detalle, null, 2)}
                      </pre>
                    ) : (
                      <span className="cifra text-[12px] line-clamp-1">{JSON.stringify(f.detalle)}</span>
                    )
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 text-sm text-slate-500">
        <span>{total} registro{total === 1 ? '' : 's'} · clic en una fila para expandir el detalle</span>
        {totalPaginas > 1 && (
          <div className="flex items-center gap-3">
            <button onClick={() => setPagina(Math.max(pagina - 1, 1))} disabled={pagina <= 1}
              className="boton-suave px-3 py-1 disabled:opacity-40">← Anterior</button>
            <span className="cifra">página {pagina} de {totalPaginas}</span>
            <button onClick={() => setPagina(Math.min(pagina + 1, totalPaginas))} disabled={pagina >= totalPaginas}
              className="boton-suave px-3 py-1 disabled:opacity-40">Siguiente →</button>
          </div>
        )}
      </div>
    </div>
  );
}
