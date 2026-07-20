import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ErrorApi } from '../api';
import type { Cliente, CompraPendiente, Cuenta, CuentaBancaria, MovimientoBanco } from '../tipos';
import { montoSiempre } from '../formato';

const PESTANAS = [
  { clave: 'movimientos', titulo: 'Movimientos' },
  { clave: 'conciliacion', titulo: 'Conciliación' },
  { clave: 'cuentas', titulo: 'Cuentas bancarias' },
] as const;

type Pestana = (typeof PESTANAS)[number]['clave'];

const TIPOS = [
  { clave: 'cheque', titulo: 'Cheque', salida: true },
  { clave: 'transferencia', titulo: 'Transferencia', salida: true },
  { clave: 'deposito', titulo: 'Depósito', salida: false },
  { clave: 'debito_bancario', titulo: 'Débito banc.', salida: true },
  { clave: 'credito_bancario', titulo: 'Crédito banc.', salida: false },
] as const;

function nombreTipo(tipo: MovimientoBanco['tipo'], numero: number | null): string {
  if (tipo === 'cheque') return `CK-${String(numero ?? 0).padStart(6, '0')}`;
  return TIPOS.find((t) => t.clave === tipo)?.titulo ?? tipo;
}

export default function Bancos() {
  const navigate = useNavigate();
  const { pestana: parametro } = useParams();
  const pestana: Pestana = PESTANAS.some((p) => p.clave === parametro) ? (parametro as Pestana) : 'movimientos';

  return (
    <div>
      <div className="inline-flex gap-1 bg-white border border-borde rounded-xl p-1 mb-5">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            onClick={() => navigate(`/bancos/${p.clave}`)}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition ${
              pestana === p.clave ? 'bg-tinta text-white' : 'text-slate-500 hover:text-tinta'
            }`}
          >
            {p.titulo}
          </button>
        ))}
      </div>

      {pestana === 'movimientos' && <TabMovimientos />}
      {pestana === 'conciliacion' && <TabConciliacion />}
      {pestana === 'cuentas' && <TabCuentas />}
    </div>
  );
}

/* ------------------------------------------------------------- movimientos */

function TabMovimientos() {
  const [movimientos, setMovimientos] = useState<MovimientoBanco[]>([]);
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);
  const [filtroCuenta, setFiltroCuenta] = useState('');
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [aviso, setAviso] = useState('');

  const cargar = () =>
    api.get<MovimientoBanco[]>(`/bancos/movimientos${filtroCuenta ? `?cuenta=${filtroCuenta}` : ''}`)
      .then(setMovimientos)
      .catch(() => setAviso('❌ Error cargando movimientos'));

  useEffect(() => { void cargar(); }, [filtroCuenta]);
  useEffect(() => {
    api.get<CuentaBancaria[]>('/bancos/cuentas').then(setCuentas).catch(() => undefined);
  }, []);

  async function anular(m: MovimientoBanco) {
    const motivo = prompt(`Motivo para anular ${nombreTipo(m.tipo, m.numero)} por C$ ${montoSiempre(m.monto)}:`);
    if (!motivo) return;
    setAviso('');
    try {
      await api.post(`/bancos/movimientos/${m.id}/anular`, { motivo });
      setAviso('✅ Movimiento anulado con contra-asiento (el número de cheque se conserva)');
      await cargar();
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al anular'}`);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <select value={filtroCuenta} onChange={(e) => setFiltroCuenta(e.target.value)} className="entrada max-w-xs">
          <option value="">Todas las cuentas</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>{c.banco} · {c.nombre} (saldo {montoSiempre(c.saldo_libro)})</option>
          ))}
        </select>
        <button onClick={() => setMostrandoForm(!mostrandoForm)} className="boton-primario">
          {mostrandoForm ? 'Ocultar formulario' : '+ Nuevo movimiento'}
        </button>
      </div>
      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {mostrandoForm && (
        <FormMovimiento
          cuentas={cuentas.filter((c) => c.activa)}
          alEmitir={(mensaje) => {
            setAviso(mensaje);
            setMostrandoForm(false);
            void cargar();
          }}
        />
      )}

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha</th><th>Documento</th><th>Cuenta</th><th>Beneficiario</th><th>Concepto</th>
              <th className="text-right">Monto C$</th><th>Estado</th><th></th>
            </tr>
          </thead>
          <tbody>
            {movimientos.length === 0 && (
              <tr><td colSpan={8} className="py-14 text-center text-slate-400">Sin movimientos bancarios</td></tr>
            )}
            {movimientos.map((m) => {
              const salida = ['cheque', 'transferencia', 'debito_bancario'].includes(m.tipo);
              return (
                <tr key={m.id} className={m.estado === 'anulado' ? 'opacity-50' : ''}>
                  <td>{m.fecha.slice(0, 10)}</td>
                  <td className="cifra font-medium">{nombreTipo(m.tipo, m.numero)}</td>
                  <td className="text-slate-500">{m.banco} · {m.cuenta_nombre}</td>
                  <td>{m.tercero_nombre ?? m.beneficiario ?? '—'}</td>
                  <td className="text-slate-500">{m.concepto}</td>
                  <td className={`text-right cifra font-medium ${salida ? 'text-rojo' : 'text-verde-oscuro'}`}>
                    {salida ? '−' : '+'}{montoSiempre(m.monto)}
                  </td>
                  <td>
                    {m.estado === 'emitido' ? (
                      m.conciliado
                        ? <span className="insignia-verde">✓ conciliado</span>
                        : <span className="insignia-ambar">● en tránsito</span>
                    ) : (
                      <span className="insignia-roja">✕ anulado</span>
                    )}
                  </td>
                  <td className="text-right">
                    {m.estado === 'emitido' && (
                      <button onClick={() => void anular(m)} className="text-sm text-rojo hover:underline">Anular</button>
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

function FormMovimiento({ cuentas, alEmitir }: { cuentas: CuentaBancaria[]; alEmitir: (mensaje: string) => void }) {
  const [cuentaId, setCuentaId] = useState('');
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]['clave']>('cheque');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [beneficiario, setBeneficiario] = useState('');
  const [concepto, setConcepto] = useState('');
  const [pagoProveedor, setPagoProveedor] = useState(false);
  const [proveedores, setProveedores] = useState<Cliente[]>([]);
  const [terceroId, setTerceroId] = useState('');
  const [pendientes, setPendientes] = useState<CompraPendiente[]>([]);
  const [montos, setMontos] = useState<Record<number, string>>({});
  const [monto, setMonto] = useState('');
  const [contrapartida, setContrapartida] = useState('');
  const [cuentasContables, setCuentasContables] = useState<Cuenta[]>([]);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const esSalida = TIPOS.find((t) => t.clave === tipo)?.salida ?? true;

  useEffect(() => {
    api.get<Cliente[]>('/proveedores').then((p) => setProveedores(p.filter((x) => x.activo))).catch(() => undefined);
    api.get<Cuenta[]>('/cuentas')
      .then((c) => setCuentasContables(c.filter((x) => x.es_detalle && x.activa)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setPendientes([]);
    setMontos({});
    if (!pagoProveedor || !terceroId) return;
    api.get<CompraPendiente[]>(`/bancos/cxp/${terceroId}`).then(setPendientes).catch(() => undefined);
  }, [pagoProveedor, terceroId]);

  const total = useMemo(() => {
    if (!pagoProveedor) return Number(monto || 0);
    let cent = 0;
    for (const v of Object.values(montos)) cent += Math.round(Number(v || 0) * 100);
    return cent / 100;
  }, [pagoProveedor, monto, montos]);

  const valida =
    cuentaId !== '' && concepto !== '' && total > 0 &&
    (pagoProveedor ? terceroId !== '' : contrapartida !== '');

  async function emitir() {
    setAviso('');
    setOcupado(true);
    try {
      const m = await api.post<MovimientoBanco>('/bancos/movimientos', {
        cuenta_bancaria_id: Number(cuentaId),
        tipo,
        fecha,
        beneficiario,
        concepto,
        tercero_id: pagoProveedor ? Number(terceroId) : null,
        monto: pagoProveedor ? undefined : Number(monto),
        contrapartida: pagoProveedor ? undefined : contrapartida,
        aplicaciones: pagoProveedor
          ? pendientes
              .filter((c) => Number(montos[c.id] || 0) > 0)
              .map((c) => ({ compra_id: c.id, monto: Number(montos[c.id]) }))
          : undefined,
      });
      alEmitir(`✅ ${nombreTipo(m.tipo, m.numero)} emitido por C$ ${montoSiempre(m.monto)}`);
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al emitir'}`);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="tarjeta p-6 mb-4">
      <div className="grid md:grid-cols-4 gap-4 mb-4">
        <div>
          <label className="etiqueta">Cuenta bancaria</label>
          <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className="entrada">
            <option value="">— cuenta —</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.banco} · {c.nombre}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="etiqueta">Tipo</label>
          <div className="inline-flex rounded-lg border border-borde bg-fondo p-1 flex-wrap">
            {TIPOS.map((t) => (
              <button key={t.clave} type="button" onClick={() => { setTipo(t.clave); if (!t.salida) setPagoProveedor(false); }}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold transition ${
                  tipo === t.clave ? 'bg-white text-tinta shadow-sm border border-borde' : 'text-slate-500'
                }`}>
                {t.titulo}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="etiqueta">Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="entrada" />
        </div>
        <div className="md:col-span-2">
          <label className="etiqueta">Concepto</label>
          <input value={concepto} onChange={(e) => setConcepto(e.target.value)}
            placeholder="Pago factura 0001234 / Depósito ventas del día…" className="entrada" />
        </div>
        <div className="md:col-span-2">
          <label className="etiqueta">Beneficiario (se imprime en el cheque)</label>
          <input value={beneficiario} onChange={(e) => setBeneficiario(e.target.value)} className="entrada" />
        </div>
      </div>

      {esSalida && (
        <label className="flex items-center gap-2 text-sm text-slate-600 mb-4">
          <input type="checkbox" checked={pagoProveedor} onChange={(e) => setPagoProveedor(e.target.checked)} />
          Es pago a proveedor (aplica a compras al crédito y baja la CxP)
        </label>
      )}

      {pagoProveedor ? (
        <div className="mb-4">
          <div className="max-w-sm mb-3">
            <label className="etiqueta">Proveedor</label>
            <select value={terceroId} onChange={(e) => setTerceroId(e.target.value)} className="entrada">
              <option value="">— proveedor —</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          {terceroId && (pendientes.length === 0 ? (
            <p className="text-sm text-slate-400">Este proveedor no tiene compras al crédito pendientes.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 text-left">
                  <th className="pb-2">Documento</th><th className="pb-2">Fecha</th>
                  <th className="pb-2 text-right">Saldo</th><th className="pb-2 w-40 text-right">Monto a pagar</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1 cifra">{c.numero_documento}</td>
                    <td className="py-1">{c.fecha.slice(0, 10)}</td>
                    <td className="py-1 text-right cifra">{montoSiempre(c.saldo)}</td>
                    <td className="py-1 pl-3">
                      <div className="flex gap-1 items-center">
                        <input type="number" min="0" step="0.01" value={montos[c.id] ?? ''}
                          onChange={(e) => setMontos({ ...montos, [c.id]: e.target.value })}
                          placeholder="0.00" className="entrada text-right" />
                        <button type="button" onClick={() => setMontos({ ...montos, [c.id]: String(c.saldo) })}
                          className="text-xs font-semibold text-verde hover:text-verde-oscuro">todo</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="etiqueta">Monto C$</label>
            <input type="number" min="0" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)}
              placeholder="0.00" className="entrada text-right cifra" />
          </div>
          <div className="md:col-span-2">
            <label className="etiqueta">{esSalida ? 'Cuenta de cargo (a qué se destina)' : 'Cuenta de origen (de dónde viene)'}</label>
            <select value={contrapartida} onChange={(e) => setContrapartida(e.target.value)} className="entrada">
              <option value="">— cuenta contable —</option>
              {cuentasContables.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <span className="text-sm">
          Total: <strong className="cifra text-lg text-verde-oscuro">C$ {montoSiempre(total)}</strong>
        </span>
        <button onClick={() => void emitir()} disabled={!valida || ocupado} className="boton-primario">
          {tipo === 'cheque' ? 'Emitir cheque' : 'Registrar movimiento'}
        </button>
      </div>
      {aviso && <p className="text-sm mt-3">{aviso}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ conciliación */

function TabConciliacion() {
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);
  const [cuentaId, setCuentaId] = useState('');
  const [movimientos, setMovimientos] = useState<MovimientoBanco[]>([]);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    api.get<CuentaBancaria[]>('/bancos/cuentas').then(setCuentas).catch(() => undefined);
  }, []);

  const cargar = () => {
    if (!cuentaId) {
      setMovimientos([]);
      return Promise.resolve();
    }
    return api.get<MovimientoBanco[]>(`/bancos/movimientos?cuenta=${cuentaId}`)
      .then((m) => setMovimientos(m.filter((x) => x.estado === 'emitido')))
      .catch(() => setAviso('❌ Error cargando movimientos'));
  };
  useEffect(() => { void cargar(); }, [cuentaId]);

  const resumen = useMemo(() => {
    let libro = 0;
    let conciliado = 0;
    for (const m of movimientos) {
      const signo = ['deposito', 'credito_bancario'].includes(m.tipo) ? 1 : -1;
      const cent = Math.round(Number(m.monto) * 100) * signo;
      libro += cent;
      if (m.conciliado) conciliado += cent;
    }
    return { libro: libro / 100, conciliado: conciliado / 100, transito: (libro - conciliado) / 100 };
  }, [movimientos]);

  async function alternar(m: MovimientoBanco) {
    setAviso('');
    try {
      await api.put(`/bancos/movimientos/${m.id}/conciliar`, { conciliado: !m.conciliado });
      await cargar();
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error'}`);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-4 flex-wrap mb-4">
        <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className="entrada max-w-xs">
          <option value="">— elegir cuenta bancaria —</option>
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.banco} · {c.nombre}</option>)}
        </select>
        {cuentaId && (
          <div className="flex gap-4 text-sm">
            <span>Saldo libro: <strong className="cifra">{montoSiempre(resumen.libro)}</strong></span>
            <span>Conciliado: <strong className="cifra text-verde-oscuro">{montoSiempre(resumen.conciliado)}</strong></span>
            <span>En tránsito (flotante): <strong className="cifra text-ambar">{montoSiempre(resumen.transito)}</strong></span>
          </div>
        )}
      </div>
      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {cuentaId && (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr><th className="w-10"></th><th>Fecha</th><th>Documento</th><th>Concepto</th>
              <th className="text-right">Monto C$</th></tr>
            </thead>
            <tbody>
              {movimientos.length === 0 && (
                <tr><td colSpan={5} className="py-12 text-center text-slate-400">Sin movimientos en esta cuenta</td></tr>
              )}
              {movimientos.map((m) => {
                const salida = ['cheque', 'transferencia', 'debito_bancario'].includes(m.tipo);
                return (
                  <tr key={m.id} className={m.conciliado ? 'bg-verde-suave/40' : ''}>
                    <td className="text-center">
                      <input type="checkbox" checked={m.conciliado} onChange={() => void alternar(m)}
                        title="Marcar como conciliado contra el estado de cuenta" />
                    </td>
                    <td>{m.fecha.slice(0, 10)}</td>
                    <td className="cifra font-medium">{nombreTipo(m.tipo, m.numero)}</td>
                    <td className="text-slate-500">{m.concepto}</td>
                    <td className={`text-right cifra font-medium ${salida ? 'text-rojo' : 'text-verde-oscuro'}`}>
                      {salida ? '−' : '+'}{montoSiempre(m.monto)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-400">
        Marcá cada movimiento cuando aparezca en el estado de cuenta del banco. El flotante son los
        cheques emitidos que el beneficiario aún no cobra. La importación del estado de cuenta llega después.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- cuentas */

function TabCuentas() {
  const [filas, setFilas] = useState<CuentaBancaria[]>([]);
  const [cuentasContables, setCuentasContables] = useState<Cuenta[]>([]);
  const [aviso, setAviso] = useState('');
  const [form, setForm] = useState<{
    id: number | null; banco: string; nombre: string; numero: string;
    moneda: 'NIO' | 'USD'; cuenta_contable: string; ultimo_cheque: string; activa: boolean;
  } | null>(null);

  const cargar = () => api.get<CuentaBancaria[]>('/bancos/cuentas').then(setFilas).catch(() => setAviso('❌ Error cargando cuentas'));
  useEffect(() => {
    void cargar();
    api.get<Cuenta[]>('/cuentas')
      .then((c) => setCuentasContables(c.filter((x) => x.tipo === 'activo' && x.es_detalle && x.activa)))
      .catch(() => undefined);
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setAviso('');
    try {
      if (form.id === null) await api.post('/bancos/cuentas', { ...form, ultimo_cheque: Number(form.ultimo_cheque || 0) });
      else await api.put(`/bancos/cuentas/${form.id}`, { ...form, ultimo_cheque: Number(form.ultimo_cheque || 0) });
      setAviso(`✅ Cuenta ${form.nombre} guardada`);
      setForm(null);
      await cargar();
    } catch (err) {
      setAviso(`❌ ${err instanceof ErrorApi ? err.message : 'Error al guardar'}`);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setForm({ id: null, banco: '', nombre: '', numero: '', moneda: 'NIO', cuenta_contable: '', ultimo_cheque: '0', activa: true })}
          className="boton-primario">+ Nueva cuenta bancaria</button>
      </div>
      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {form && (
        <form onSubmit={guardar} className="tarjeta p-6 mb-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="etiqueta">Banco</label>
              <input required value={form.banco} placeholder="BAC / Lafise / Banpro"
                onChange={(e) => setForm({ ...form, banco: e.target.value })} className="entrada" />
            </div>
            <div>
              <label className="etiqueta">Nombre de la cuenta</label>
              <input required value={form.nombre} placeholder="Operativa córdobas"
                onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="entrada" />
            </div>
            <div>
              <label className="etiqueta">Nº de cuenta</label>
              <input required value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })}
                className="entrada cifra" />
            </div>
            <div>
              <label className="etiqueta">Moneda</label>
              <select value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value as 'NIO' | 'USD' })} className="entrada">
                <option value="NIO">NIO (córdobas)</option>
                <option value="USD" disabled>USD — llega con multimoneda</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-400">
                Las cuentas en dólares se habilitan cuando el sistema soporte conversión al tipo de cambio.
              </p>
            </div>
            <div>
              <label className="etiqueta">Cuenta contable</label>
              <select required value={form.cuenta_contable}
                onChange={(e) => setForm({ ...form, cuenta_contable: e.target.value })} className="entrada">
                <option value="">— cuenta de activo —</option>
                {cuentasContables.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="etiqueta">Último cheque usado</label>
              <input type="number" min="0" step="1" value={form.ultimo_cheque}
                onChange={(e) => setForm({ ...form, ultimo_cheque: e.target.value })} className="entrada text-right cifra" />
              <p className="mt-1 text-[11px] text-slate-400">El próximo cheque será este + 1 (para continuar la chequera actual).</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
              Activa
            </label>
          </div>
          <div className="flex gap-2 mt-5">
            <button type="submit" className="boton-primario">Guardar</button>
            <button type="button" onClick={() => setForm(null)} className="boton-suave">Cancelar</button>
          </div>
        </form>
      )}

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr><th>Banco</th><th>Cuenta</th><th>Número</th><th>Moneda</th><th>Cuenta contable</th>
            <th className="text-right">Últ. cheque</th><th className="text-right">Saldo libro C$</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr><td colSpan={9} className="py-14 text-center text-slate-400">
                Sin cuentas bancarias — creá la primera con su cuenta contable de enlace
              </td></tr>
            )}
            {filas.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.banco}</td>
                <td className="font-medium">{c.nombre}</td>
                <td className="cifra text-slate-500">{c.numero}</td>
                <td className="text-slate-500">{c.moneda}</td>
                <td className="cifra text-slate-500">{c.cuenta_contable}</td>
                <td className="text-right cifra">{c.ultimo_cheque}</td>
                <td className="text-right cifra font-medium">{montoSiempre(c.saldo_libro)}</td>
                <td>{c.activa ? <span className="insignia-verde">activa</span> : <span className="insignia-gris">inactiva</span>}</td>
                <td className="text-right">
                  <button onClick={() => setForm({
                    id: c.id, banco: c.banco, nombre: c.nombre, numero: c.numero, moneda: c.moneda,
                    cuenta_contable: c.cuenta_contable, ultimo_cheque: String(c.ultimo_cheque), activa: c.activa,
                  })} className="text-sm font-semibold text-verde hover:text-verde-oscuro">Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
