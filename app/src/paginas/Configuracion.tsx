import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ErrorApi } from '../api';
import type { Bodega, ClaveConfig, ControlSerie, Cuenta, Serie, Sucursal, Vendedor } from '../tipos';

const PESTANAS = [
  { clave: 'sucursales', titulo: 'Sucursales' },
  { clave: 'bodegas', titulo: 'Bodegas' },
  { clave: 'vendedores', titulo: 'Vendedores' },
  { clave: 'series', titulo: 'Series de factura' },
  { clave: 'parametros', titulo: 'Parámetros' },
] as const;

type Pestana = (typeof PESTANAS)[number]['clave'];

export default function Configuracion() {
  const [pestana, setPestana] = useState<Pestana>('sucursales');

  return (
    <div className="max-w-4xl">
      <div className="inline-flex gap-1 bg-white border border-borde rounded-xl p-1 mb-5 flex-wrap">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            onClick={() => setPestana(p.clave)}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition ${
              pestana === p.clave ? 'bg-tinta text-white' : 'text-slate-500 hover:text-tinta'
            }`}
          >
            {p.titulo}
          </button>
        ))}
      </div>

      {pestana === 'sucursales' && <TabSucursales />}
      {pestana === 'bodegas' && <TabBodegas />}
      {pestana === 'vendedores' && <TabVendedores />}
      {pestana === 'series' && <TabSeries />}
      {pestana === 'parametros' && <TabParametros />}
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return texto ? <p className="text-sm mb-3">{texto}</p> : null;
}

function Estado({ activa }: { activa: boolean }) {
  return activa ? <span className="insignia-verde">activa</span> : <span className="insignia-gris">inactiva</span>;
}

function PanelForm({ children, onSubmit, alCancelar }: {
  children: ReactNode;
  onSubmit: (e: FormEvent) => void;
  alCancelar: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="tarjeta p-6 mb-4">
      {children}
      <div className="flex gap-2 mt-5">
        <button type="submit" className="boton-primario">Guardar</button>
        <button type="button" onClick={alCancelar} className="boton-suave">Cancelar</button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------- sucursales */

function TabSucursales() {
  const [filas, setFilas] = useState<Sucursal[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [aviso, setAviso] = useState('');
  const [form, setForm] = useState<{ editando: string | null; codigo: string; nombre: string; direccion: string; telefono: string; cuenta_caja: string; activa: boolean } | null>(null);

  const cargar = () => api.get<Sucursal[]>('/configuracion/sucursales').then(setFilas).catch(() => setAviso('❌ Error cargando sucursales'));
  useEffect(() => {
    void cargar();
    api.get<Cuenta[]>('/cuentas')
      .then((c) => setCuentas(c.filter((x) => x.tipo === 'activo' && x.es_detalle && x.activa)))
      .catch(() => undefined);
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setAviso('');
    try {
      if (form.editando === null) {
        await api.post('/configuracion/sucursales', form);
      } else {
        await api.put(`/configuracion/sucursales/${form.editando}`, form);
      }
      setAviso(`✅ Sucursal ${form.codigo} guardada`);
      setForm(null);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al guardar'}`);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setForm({ editando: null, codigo: '', nombre: '', direccion: '', telefono: '', cuenta_caja: '', activa: true })} className="boton-primario">
          + Nueva sucursal
        </button>
      </div>
      <Aviso texto={aviso} />
      {form && (
        <PanelForm onSubmit={guardar} alCancelar={() => setForm(null)}>
          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <label className="etiqueta">Código</label>
              <input required disabled={form.editando !== null} value={form.codigo} placeholder="CEN"
                onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })} className="entrada cifra" />
            </div>
            <div className="md:col-span-3">
              <label className="etiqueta">Nombre</label>
              <input required value={form.nombre} placeholder="Sucursal Central"
                onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="entrada" />
            </div>
            <div className="md:col-span-2">
              <label className="etiqueta">Dirección</label>
              <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} className="entrada" />
            </div>
            <div>
              <label className="etiqueta">Teléfono</label>
              <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} className="entrada cifra" />
            </div>
            <div className="md:col-span-2">
              <label className="etiqueta">Cuenta de caja (ventas de contado)</label>
              <select value={form.cuenta_caja} onChange={(e) => setForm({ ...form, cuenta_caja: e.target.value })} className="entrada">
                <option value="">— caja general (config) —</option>
                {cuentas.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">
                La plata de las facturas de contado de esta tienda cae aquí. Sin asignar = caja general.
              </p>
            </div>
            <label className="flex items-end gap-2 text-sm text-slate-600 pb-2">
              <input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
              Activa
            </label>
          </div>
        </PanelForm>
      )}
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Código</th><th>Nombre</th><th>Dirección</th><th>Caja</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-slate-400">Sin sucursales — creá la primera</td></tr>}
            {filas.map((s) => (
              <tr key={s.codigo}>
                <td className="cifra font-medium">{s.codigo}</td>
                <td className="font-medium">{s.nombre}</td>
                <td className="text-slate-500">{s.direccion ?? '—'}</td>
                <td className="cifra text-slate-500">{s.cuenta_caja ?? 'general'}</td>
                <td><Estado activa={s.activa} /></td>
                <td className="text-right">
                  <button onClick={() => setForm({ editando: s.codigo, codigo: s.codigo, nombre: s.nombre, direccion: s.direccion ?? '', telefono: s.telefono ?? '', cuenta_caja: s.cuenta_caja ?? '', activa: s.activa })}
                    className="text-sm font-semibold text-verde hover:text-verde-oscuro">Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- bodegas */

function TabBodegas() {
  const [filas, setFilas] = useState<Bodega[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [aviso, setAviso] = useState('');
  const [form, setForm] = useState<{ editando: string | null; codigo: string; nombre: string; sucursal: string; activa: boolean } | null>(null);

  const cargar = () => api.get<Bodega[]>('/configuracion/bodegas').then(setFilas).catch(() => setAviso('❌ Error cargando bodegas'));
  useEffect(() => {
    void cargar();
    api.get<Sucursal[]>('/configuracion/sucursales').then((s) => setSucursales(s.filter((x) => x.activa))).catch(() => undefined);
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setAviso('');
    try {
      if (form.editando === null) await api.post('/configuracion/bodegas', form);
      else await api.put(`/configuracion/bodegas/${form.editando}`, form);
      setAviso(`✅ Bodega ${form.codigo} guardada`);
      setForm(null);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al guardar'}`);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setForm({ editando: null, codigo: '', nombre: '', sucursal: '', activa: true })} className="boton-primario">
          + Nueva bodega
        </button>
      </div>
      <Aviso texto={aviso} />
      {form && (
        <PanelForm onSubmit={guardar} alCancelar={() => setForm(null)}>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="etiqueta">Código</label>
              <input required disabled={form.editando !== null} value={form.codigo} placeholder="BOD-CEN"
                onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })} className="entrada cifra" />
            </div>
            <div>
              <label className="etiqueta">Nombre</label>
              <input required value={form.nombre} placeholder="Bodega principal"
                onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="entrada" />
            </div>
            <div>
              <label className="etiqueta">Sucursal</label>
              <select required value={form.sucursal} onChange={(e) => setForm({ ...form, sucursal: e.target.value })} className="entrada">
                <option value="">— sucursal —</option>
                {sucursales.map((s) => <option key={s.codigo} value={s.codigo}>{s.codigo} · {s.nombre}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
              Activa
            </label>
          </div>
        </PanelForm>
      )}
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Código</th><th>Nombre</th><th>Sucursal</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-slate-400">Sin bodegas — el inventario las usará más adelante</td></tr>}
            {filas.map((b) => (
              <tr key={b.codigo}>
                <td className="cifra font-medium">{b.codigo}</td>
                <td className="font-medium">{b.nombre}</td>
                <td className="text-slate-500">{b.sucursal_nombre ?? b.sucursal}</td>
                <td><Estado activa={b.activa} /></td>
                <td className="text-right">
                  <button onClick={() => setForm({ editando: b.codigo, codigo: b.codigo, nombre: b.nombre, sucursal: b.sucursal, activa: b.activa })}
                    className="text-sm font-semibold text-verde hover:text-verde-oscuro">Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- vendedores */

function TabVendedores() {
  const [filas, setFilas] = useState<Vendedor[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [aviso, setAviso] = useState('');
  const [form, setForm] = useState<{ editando: number | null; codigo: string; nombre: string; sucursal: string; activo: boolean } | null>(null);

  const cargar = () => api.get<Vendedor[]>('/configuracion/vendedores').then(setFilas).catch(() => setAviso('❌ Error cargando vendedores'));
  useEffect(() => {
    void cargar();
    api.get<Sucursal[]>('/configuracion/sucursales').then((s) => setSucursales(s.filter((x) => x.activa))).catch(() => undefined);
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setAviso('');
    const datos = { codigo: form.codigo || null, nombre: form.nombre, sucursal: form.sucursal || null, activo: form.activo };
    try {
      if (form.editando === null) await api.post('/configuracion/vendedores', datos);
      else await api.put(`/configuracion/vendedores/${form.editando}`, datos);
      setAviso(`✅ Vendedor "${form.nombre}" guardado`);
      setForm(null);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al guardar'}`);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setForm({ editando: null, codigo: '', nombre: '', sucursal: '', activo: true })} className="boton-primario">
          + Nuevo vendedor
        </button>
      </div>
      <Aviso texto={aviso} />
      {form && (
        <PanelForm onSubmit={guardar} alCancelar={() => setForm(null)}>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="etiqueta">Código (opcional)</label>
              <input value={form.codigo} placeholder="V-01"
                onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })} className="entrada cifra" />
            </div>
            <div>
              <label className="etiqueta">Nombre</label>
              <input required value={form.nombre} placeholder="María López"
                onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="entrada" />
            </div>
            <div>
              <label className="etiqueta">Sucursal</label>
              <select value={form.sucursal} onChange={(e) => setForm({ ...form, sucursal: e.target.value })} className="entrada">
                <option value="">— sin asignar —</option>
                {sucursales.map((s) => <option key={s.codigo} value={s.codigo}>{s.codigo} · {s.nombre}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
              Activo
            </label>
          </div>
        </PanelForm>
      )}
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Código</th><th>Nombre</th><th>Sucursal</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-slate-400">Sin vendedores — creá el primero</td></tr>}
            {filas.map((v) => (
              <tr key={v.id}>
                <td className="cifra font-medium">{v.codigo ?? '—'}</td>
                <td className="font-medium">{v.nombre}</td>
                <td className="text-slate-500">{v.sucursal_nombre ?? '—'}</td>
                <td><Estado activa={v.activo} /></td>
                <td className="text-right">
                  <button onClick={() => setForm({ editando: v.id, codigo: v.codigo ?? '', nombre: v.nombre, sucursal: v.sucursal ?? '', activo: v.activo })}
                    className="text-sm font-semibold text-verde hover:text-verde-oscuro">Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ series */

function TabSeries() {
  const [filas, setFilas] = useState<Serie[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [aviso, setAviso] = useState('');
  const [control, setControl] = useState<ControlSerie | null>(null);
  const [form, setForm] = useState<{ editando: string | null; serie: string; sucursal: string; tipo: 'sistema' | 'manual'; prefijo: string; ultimo_numero: string; numero_desde: string; activa: boolean } | null>(null);

  const cargar = () => api.get<Serie[]>('/series').then(setFilas).catch(() => setAviso('❌ Error cargando series'));
  useEffect(() => {
    void cargar();
    api.get<Sucursal[]>('/configuracion/sucursales').then((s) => setSucursales(s.filter((x) => x.activa))).catch(() => undefined);
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setAviso('');
    try {
      if (form.editando === null) {
        await api.post('/series', {
          ...form,
          ultimo_numero: Number(form.ultimo_numero || 0),
          numero_desde: Number(form.numero_desde || 1),
        });
      } else {
        await api.put(`/series/${form.editando}`, {
          sucursal: form.sucursal,
          activa: form.activa,
          ultimo_numero: form.ultimo_numero === '' ? undefined : Number(form.ultimo_numero),
          numero_desde: form.numero_desde === '' ? undefined : Number(form.numero_desde),
        });
      }
      setAviso(`✅ Serie ${form.serie} guardada`);
      setForm(null);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al guardar'}`);
    }
  }

  async function verControl(serie: string) {
    setAviso('');
    try {
      setControl(await api.get<ControlSerie>(`/series/${encodeURIComponent(serie)}/control`));
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error cargando control'}`);
    }
  }

  async function grabarDanada(serie: string) {
    const numero = prompt(`Nº de la factura de papel dañada (serie ${serie}):`);
    if (!numero) return;
    const motivo = prompt('Motivo (queda en bitácora):');
    if (!motivo) return;
    setAviso('');
    try {
      await api.post('/facturas/manual-anulada', { serie, numero: Number(numero), motivo });
      setAviso(`✅ Nº ${numero} grabado como anulado — el consecutivo queda completo`);
      await verControl(serie);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al grabar'}`);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setForm({ editando: null, serie: '', sucursal: '', tipo: 'sistema', prefijo: '', ultimo_numero: '0', numero_desde: '1', activa: true })} className="boton-primario">
          + Nueva serie
        </button>
      </div>
      <Aviso texto={aviso} />
      {form && (
        <PanelForm onSubmit={guardar} alCancelar={() => setForm(null)}>
          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <label className="etiqueta">Serie</label>
              <input required disabled={form.editando !== null} value={form.serie} placeholder="A-CEN"
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  setForm({ ...form, serie: v, prefijo: form.editando === null ? `${v}-` : form.prefijo });
                }} className="entrada cifra" />
            </div>
            <div>
              <label className="etiqueta">Sucursal</label>
              <select required value={form.sucursal} onChange={(e) => setForm({ ...form, sucursal: e.target.value })} className="entrada">
                <option value="">— sucursal —</option>
                {sucursales.map((s) => <option key={s.codigo} value={s.codigo}>{s.codigo} · {s.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="etiqueta">Tipo</label>
              <select disabled={form.editando !== null} value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value as 'sistema' | 'manual' })} className="entrada">
                <option value="sistema">Sistema</option>
                <option value="manual">Manual (talonario)</option>
              </select>
            </div>
            <div>
              <label className="etiqueta">Prefijo</label>
              <input required disabled={form.editando !== null} value={form.prefijo} placeholder="A-CEN-"
                onChange={(e) => setForm({ ...form, prefijo: e.target.value.toUpperCase() })} className="entrada cifra" />
            </div>
            {form.tipo === 'sistema' ? (
              <div>
                <label className="etiqueta">Último número usado</label>
                <input type="number" min="0" step="1" value={form.ultimo_numero}
                  onChange={(e) => setForm({ ...form, ultimo_numero: e.target.value })}
                  className="entrada text-right cifra" />
                <p className="mt-1 text-[11px] text-slate-400">
                  El siguiente emitido será este + 1. Para continuar el consecutivo del
                  sistema viejo, poné aquí el último número usado. Nunca baja de lo ya grabado.
                </p>
              </div>
            ) : (
              <div>
                <label className="etiqueta">El talonario empieza en Nº</label>
                <input type="number" min="1" step="1" value={form.numero_desde}
                  onChange={(e) => setForm({ ...form, numero_desde: e.target.value })}
                  className="entrada text-right cifra" />
                <p className="mt-1 text-[11px] text-slate-400">
                  No se graban números de papel por debajo de este; los huecos se
                  cuentan desde aquí.
                </p>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
              Activa
            </label>
          </div>
        </PanelForm>
      )}
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Serie</th><th>Sucursal</th><th>Tipo</th><th>Prefijo</th><th className="text-right">Último número</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={7} className="py-12 text-center text-slate-400">Sin series — cada sucursal necesita al menos una para facturar</td></tr>}
            {filas.map((s) => (
              <tr key={s.serie}>
                <td className="cifra font-medium">{s.serie}</td>
                <td className="text-slate-500">{s.sucursal_nombre ?? s.tienda ?? '—'}</td>
                <td className="text-slate-500 capitalize">
                  {s.tipo}{s.documento !== 'factura' ? ` · ${s.documento === 'recibo' ? 'recibos' : 'NC'}` : ''}
                </td>
                <td className="cifra text-slate-500">{s.prefijo}</td>
                <td className="text-right cifra">{s.ultimo_numero}</td>
                <td><Estado activa={s.activa} /></td>
                <td className="text-right space-x-3 whitespace-nowrap">
                  <button onClick={() => void verControl(s.serie)}
                    className="text-sm font-semibold text-slate-500 hover:text-tinta">Control</button>
                  <button onClick={() => setForm({ editando: s.serie, serie: s.serie, sucursal: s.sucursal ?? '', tipo: s.tipo, prefijo: s.prefijo, ultimo_numero: String(s.ultimo_numero), numero_desde: String(s.numero_desde ?? 1), activa: s.activa })}
                    className="text-sm font-semibold text-verde hover:text-verde-oscuro">Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        El último número solo avanza al emitir facturas — nunca se edita a mano: el consecutivo es sagrado ante la DGI.
      </p>

      {control && (
        <div className="tarjeta p-5 mt-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-bold text-tinta">
              Control de la serie <span className="cifra">{control.serie.serie}</span>
              {control.serie.tipo === 'manual' && <span className="insignia-ambar ml-2">manual</span>}
            </h3>
            <button onClick={() => setControl(null)} className="text-sm text-slate-400 hover:text-tinta">Cerrar ✕</button>
          </div>
          <div className="flex flex-wrap gap-6 text-sm mb-3">
            <span>Emitidas: <strong className="cifra">{control.emitidas}</strong></span>
            <span>Anuladas: <strong className="cifra">{control.anuladas}</strong></span>
            <span>Borradores: <strong className="cifra">{control.borradores}</strong></span>
            <span>
              Rango grabado: <strong className="cifra">{control.minimo > 0 ? `${control.minimo} – ${control.maximo}` : '—'}</strong>
            </span>
          </div>
          {control.huecos.length === 0 ? (
            <p className="text-sm text-verde-oscuro font-medium">✅ Consecutivo completo — sin huecos</p>
          ) : (
            <div>
              <p className="text-sm text-rojo font-semibold mb-2">
                ⚠️ {control.huecos.length} número(s) sin justificar — perseguir el papel:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {control.huecos.map((n) => (
                  <span key={n} className="insignia-roja cifra">{n}</span>
                ))}
              </div>
            </div>
          )}
          {control.serie.tipo === 'manual' && (
            <button onClick={() => void grabarDanada(control.serie.serie)} className="boton-suave mt-4">
              Grabar Nº de papel dañado como anulado
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- parámetros */

function TabParametros() {
  const [filas, setFilas] = useState<ClaveConfig[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = () => api.get<ClaveConfig[]>('/config').then(setFilas).catch(() => setAviso('❌ Error cargando parámetros'));
  useEffect(() => { void cargar(); }, []);

  async function guardar(clave: string) {
    setAviso('');
    try {
      await api.put(`/config/${clave}`, { valor });
      setAviso(`✅ ${clave} actualizado (quedó en bitácora)`);
      setEditando(null);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al guardar'}`);
    }
  }

  return (
    <div>
      <Aviso texto={aviso} />
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Parámetro</th><th>Descripción</th><th>Valor</th><th></th></tr></thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.clave}>
                <td className="cifra font-medium">{c.clave}</td>
                <td className="text-slate-500">{c.descripcion ?? '—'}</td>
                <td className="cifra">
                  {editando === c.clave ? (
                    <input autoFocus value={valor} onChange={(e) => setValor(e.target.value)} className="entrada max-w-40" />
                  ) : (
                    c.valor
                  )}
                </td>
                <td className="text-right">
                  {editando === c.clave ? (
                    <span className="inline-flex gap-3">
                      <button onClick={() => void guardar(c.clave)} className="text-sm font-semibold text-verde hover:text-verde-oscuro">Guardar</button>
                      <button onClick={() => setEditando(null)} className="text-sm text-slate-400 hover:text-tinta">Cancelar</button>
                    </span>
                  ) : (
                    <button onClick={() => { setEditando(c.clave); setValor(c.valor); }} className="text-sm font-semibold text-verde hover:text-verde-oscuro">Editar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Cambiar un parámetro es acción de administrador y queda registrado en la bitácora (quién, qué y cuándo).
      </p>
    </div>
  );
}
