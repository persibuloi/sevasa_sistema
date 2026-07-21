import { useEffect, useState, type FormEvent } from 'react';
import { api, ErrorApi } from '../api';
import type { Bodega, Sucursal, UsuarioFicha, Vendedor } from '../tipos';

const ROLES = [
  { clave: 'admin', titulo: 'Admin', descripcion: 'todo el sistema' },
  { clave: 'contador', titulo: 'Contador', descripcion: 'contabilidad completa y cierres' },
  { clave: 'cajero', titulo: 'Cajero', descripcion: 'cobros y bancos, no anula' },
  { clave: 'facturador', titulo: 'Facturador', descripcion: 'emite facturas, no anula' },
  { clave: 'comprador', titulo: 'Comprador', descripcion: 'compras y traslados' },
  { clave: 'consulta', titulo: 'Consulta', descripcion: 'solo lectura' },
];

interface Form {
  editando: string | null;   // id
  email: string;
  clave: string;
  nombre: string;
  cedula: string;
  telefono: string;
  direccion: string;
  cargo: string;
  fecha_ingreso: string;
  notas: string;
  sucursal: string;
  bodega: string;
  vendedor_id: string;
  roles: string[];
  activo: boolean;
}

const FORM0: Form = {
  editando: null, email: '', clave: '', nombre: '', cedula: '', telefono: '', direccion: '',
  cargo: '', fecha_ingreso: '', notas: '', sucursal: '', bodega: '', vendedor_id: '',
  roles: [], activo: true,
};

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState<UsuarioFicha[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = () => api.get<UsuarioFicha[]>('/usuarios').then(setUsuarios).catch((e) => setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error cargando usuarios'}`));
  useEffect(() => {
    void cargar();
    api.get<Sucursal[]>('/configuracion/sucursales').then((s) => setSucursales(s.filter((x) => x.activa))).catch(() => undefined);
    api.get<Bodega[]>('/configuracion/bodegas').then((b) => setBodegas(b.filter((x) => x.activa))).catch(() => undefined);
    api.get<Vendedor[]>('/configuracion/vendedores').then((v) => setVendedores(v.filter((x) => x.activo))).catch(() => undefined);
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setAviso('');
    setOcupado(true);
    const datos = {
      email: form.email, clave: form.clave || undefined, nombre: form.nombre,
      cedula: form.cedula, telefono: form.telefono, direccion: form.direccion,
      cargo: form.cargo, fecha_ingreso: form.fecha_ingreso || undefined, notas: form.notas,
      sucursal: form.sucursal || null, bodega: form.bodega || null,
      vendedor_id: form.vendedor_id ? Number(form.vendedor_id) : null,
      roles: form.roles, activo: form.activo,
    };
    try {
      if (form.editando === null) await api.post('/usuarios', datos);
      else await api.put(`/usuarios/${form.editando}`, datos);
      setAviso(`✅ Usuario ${form.nombre} guardado`);
      setForm(null);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al guardar'}`);
    } finally {
      setOcupado(false);
    }
  }

  async function resetClave(u: UsuarioFicha) {
    const clave = prompt(`Nueva contraseña para ${u.nombre} (mínimo 8 caracteres):`);
    if (!clave) return;
    setAviso('');
    try {
      await api.post(`/usuarios/${u.id}/reset-clave`, { clave });
      setAviso(`✅ Contraseña de ${u.nombre} restablecida (queda en bitácora)`);
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error'}`);
    }
  }

  const bodegasDeSucursal = form?.sucursal ? bodegas.filter((b) => b.sucursal === form.sucursal) : bodegas;
  const vendedoresDeSucursal = form?.sucursal ? vendedores.filter((v) => !v.sucursal || v.sucursal === form.sucursal) : vendedores;

  return (
    <div className="max-w-5xl">
      <div className="flex justify-end mb-3">
        <button onClick={() => setForm({ ...FORM0 })} className="boton-primario">+ Nuevo usuario</button>
      </div>
      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {form && (
        <form onSubmit={guardar} className="tarjeta p-6 mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400 mb-3">Credenciales</div>
          <div className="grid md:grid-cols-3 gap-4 mb-5">
            <div>
              <label className="etiqueta">Correo (login)</label>
              <input type="email" required disabled={form.editando !== null} value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} className="entrada" />
            </div>
            {form.editando === null && (
              <div>
                <label className="etiqueta">Contraseña inicial (mín. 8)</label>
                <input type="text" required minLength={8} value={form.clave}
                  onChange={(e) => setForm({ ...form, clave: e.target.value })} className="entrada cifra" />
              </div>
            )}
            <label className="flex items-end gap-2 text-sm text-slate-600 pb-2">
              <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
              Activo (puede entrar al sistema)
            </label>
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400 mb-3">Datos personales</div>
          <div className="grid md:grid-cols-3 gap-4 mb-5">
            <div><label className="etiqueta">Nombre completo</label>
              <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="entrada" /></div>
            <div><label className="etiqueta">Cédula</label>
              <input value={form.cedula} onChange={(e) => setForm({ ...form, cedula: e.target.value })} className="entrada cifra" /></div>
            <div><label className="etiqueta">Teléfono</label>
              <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} className="entrada cifra" /></div>
            <div className="md:col-span-2"><label className="etiqueta">Dirección</label>
              <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} className="entrada" /></div>
            <div><label className="etiqueta">Cargo</label>
              <input value={form.cargo} placeholder="Vendedor, Cajera, Bodeguero…"
                onChange={(e) => setForm({ ...form, cargo: e.target.value })} className="entrada" /></div>
            <div><label className="etiqueta">Fecha de ingreso</label>
              <input type="date" value={form.fecha_ingreso} onChange={(e) => setForm({ ...form, fecha_ingreso: e.target.value })} className="entrada" /></div>
            <div className="md:col-span-2"><label className="etiqueta">Notas</label>
              <input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} className="entrada" /></div>
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400 mb-3">Roles (otorgan los permisos)</div>
          <div className="flex flex-wrap gap-2 mb-5">
            {ROLES.map((r) => {
              const activo = form.roles.includes(r.clave);
              return (
                <button key={r.clave} type="button" title={r.descripcion}
                  onClick={() => setForm({ ...form, roles: activo ? form.roles.filter((x) => x !== r.clave) : [...form.roles, r.clave] })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition ${
                    activo ? 'bg-verde text-white border-verde' : 'bg-white text-slate-500 border-borde hover:border-slate-300'
                  }`}>
                  {activo ? '✓ ' : ''}{r.titulo}
                </button>
              );
            })}
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400 mb-3">
            Amarres operativos (con sucursal/bodega asignada, solo opera en la suya)
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="etiqueta">Sucursal</label>
              <select value={form.sucursal}
                onChange={(e) => setForm({ ...form, sucursal: e.target.value, bodega: '', vendedor_id: '' })} className="entrada">
                <option value="">— sin amarre (opera en todas) —</option>
                {sucursales.map((s) => <option key={s.codigo} value={s.codigo}>{s.codigo} · {s.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="etiqueta">Bodega</label>
              <select value={form.bodega} onChange={(e) => setForm({ ...form, bodega: e.target.value })} className="entrada">
                <option value="">— sin amarre —</option>
                {bodegasDeSucursal.map((b) => <option key={b.codigo} value={b.codigo}>{b.codigo} · {b.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="etiqueta">Es el vendedor</label>
              <select value={form.vendedor_id} onChange={(e) => setForm({ ...form, vendedor_id: e.target.value })} className="entrada">
                <option value="">— no es vendedor —</option>
                {vendedoresDeSucursal.map((v) => <option key={v.id} value={v.id}>{v.codigo ? `${v.codigo} · ` : ''}{v.nombre}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <button type="submit" disabled={form.roles.length === 0 || ocupado} className="boton-primario">
              {form.editando === null ? 'Crear usuario' : 'Guardar cambios'}
            </button>
            <button type="button" onClick={() => setForm(null)} className="boton-suave">Cancelar</button>
            {form.roles.length === 0 && <span className="text-sm text-ambar self-center">asigná al menos un rol</span>}
          </div>
        </form>
      )}

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr><th>Usuario</th><th>Roles</th><th>Sucursal / Bodega</th><th>Último acceso</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {usuarios.length === 0 && (
              <tr><td colSpan={6} className="py-14 text-center text-slate-400">Sin usuarios</td></tr>
            )}
            {usuarios.map((u) => (
              <tr key={u.id} className={u.activo ? '' : 'opacity-50'}>
                <td>
                  <div className="font-medium">{u.nombre}</div>
                  <div className="text-[12px] text-slate-400">{u.email}{u.cargo ? ` · ${u.cargo}` : ''}</div>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <span key={r} className={r === 'admin' ? 'insignia-ambar' : 'insignia-gris'}>{r}</span>
                    ))}
                  </div>
                </td>
                <td className="text-slate-500">
                  {u.sucursal_nombre ?? 'todas'}{u.bodega_nombre ? ` · ${u.bodega_nombre}` : ''}
                  {u.vendedor_nombre ? <div className="text-[11px]">vendedor: {u.vendedor_nombre}</div> : null}
                </td>
                <td className="text-slate-500 cifra text-[12px]">{u.ultimo_acceso ? u.ultimo_acceso.slice(0, 16).replace('T', ' ') : 'nunca'}</td>
                <td>{u.activo ? <span className="insignia-verde">activo</span> : <span className="insignia-roja">desactivado</span>}</td>
                <td className="text-right space-x-3 whitespace-nowrap">
                  <button onClick={() => setForm({
                    editando: u.id, email: u.email, clave: '', nombre: u.nombre,
                    cedula: u.cedula ?? '', telefono: u.telefono ?? '', direccion: u.direccion ?? '',
                    cargo: u.cargo ?? '', fecha_ingreso: u.fecha_ingreso?.slice(0, 10) ?? '', notas: u.notas ?? '',
                    sucursal: u.sucursal ?? '', bodega: u.bodega ?? '',
                    vendedor_id: u.vendedor_id ? String(u.vendedor_id) : '',
                    roles: u.roles, activo: u.activo,
                  })} className="text-sm font-semibold text-verde hover:text-verde-oscuro">Editar</button>
                  <button onClick={() => void resetClave(u)} className="text-sm text-slate-500 hover:text-tinta">Reset clave</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Los usuarios nunca se borran (sus acciones viven en la bitácora): se desactivan y no pueden entrar más.
      </p>
    </div>
  );
}
