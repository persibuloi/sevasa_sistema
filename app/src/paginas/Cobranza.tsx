import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ErrorApi } from '../api';
import type { Cliente, Factura, FacturaPendiente, NotaCredito, Recibo, ResumenCartera } from '../tipos';
import { montoSiempre } from '../formato';

const PESTANAS = [
  { clave: 'cartera', titulo: 'Cartera' },
  { clave: 'recibos', titulo: 'Recibos de cobro' },
  { clave: 'notas', titulo: 'Notas de crédito' },
] as const;

type Pestana = (typeof PESTANAS)[number]['clave'];

export default function Cobranza() {
  const navigate = useNavigate();
  const { pestana: parametro } = useParams();
  const pestana: Pestana = PESTANAS.some((p) => p.clave === parametro) ? (parametro as Pestana) : 'cartera';

  return (
    <div>
      <div className="inline-flex gap-1 bg-white border border-borde rounded-xl p-1 mb-5">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            onClick={() => navigate(`/cobranza/${p.clave}`)}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition ${
              pestana === p.clave ? 'bg-tinta text-white' : 'text-slate-500 hover:text-tinta'
            }`}
          >
            {p.titulo}
          </button>
        ))}
      </div>

      {pestana === 'cartera' && <TabCartera />}
      {pestana === 'recibos' && <TabRecibos />}
      {pestana === 'notas' && <TabNotas />}
    </div>
  );
}

/* ----------------------------------------------------------------- cartera */

const BUCKETS: Array<{ clave: keyof ResumenCartera; titulo: string }> = [
  { clave: 'corriente', titulo: 'Corriente' },
  { clave: 'd1_30', titulo: '1–30 días' },
  { clave: 'd31_60', titulo: '31–60 días' },
  { clave: 'd61_90', titulo: '61–90 días' },
  { clave: 'd90_mas', titulo: '+90 días' },
];

function TabCartera() {
  const [facturas, setFacturas] = useState<FacturaPendiente[]>([]);
  const [resumen, setResumen] = useState<ResumenCartera | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ facturas: FacturaPendiente[]; resumen: ResumenCartera }>('/cxc/cartera')
      .then((d) => {
        setFacturas(d.facturas);
        setResumen(d.resumen);
      })
      .catch((e) => setError(e instanceof ErrorApi ? e.message : 'Error cargando cartera'));
  }, []);

  return (
    <div>
      {error && <p className="text-sm text-rojo mb-3">{error}</p>}

      {resumen && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
          {BUCKETS.map((b) => (
            <div key={b.clave} className="tarjeta px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{b.titulo}</div>
              <div className={`cifra text-lg font-bold mt-1 ${b.clave === 'd90_mas' && resumen[b.clave] > 0 ? 'text-rojo' : 'text-tinta'}`}>
                {montoSiempre(resumen[b.clave])}
              </div>
            </div>
          ))}
          <div className="tarjeta px-4 py-3 bg-tinta text-white border-tinta">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">Total cartera</div>
            <div className="cifra text-lg font-bold mt-1">{montoSiempre(resumen.total)}</div>
          </div>
        </div>
      )}

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Cliente</th><th>Factura</th><th>Fecha</th><th>Vence</th><th>Atraso</th>
              <th className="text-right">Total</th><th className="text-right">Abonado</th><th className="text-right">Saldo C$</th>
            </tr>
          </thead>
          <tbody>
            {facturas.length === 0 && (
              <tr><td colSpan={8} className="py-14 text-center text-slate-400">Cartera en cero — no hay facturas de crédito pendientes</td></tr>
            )}
            {facturas.map((f) => (
              <tr key={f.id}>
                <td className="font-medium">{f.cliente}</td>
                <td className="cifra">{f.numero_completo}</td>
                <td>{f.fecha.slice(0, 10)}</td>
                <td>{f.vence}</td>
                <td>
                  {(f.dias_vencida ?? 0) === 0 ? (
                    <span className="insignia-verde">al día</span>
                  ) : (f.dias_vencida ?? 0) <= 30 ? (
                    <span className="insignia-ambar">{f.dias_vencida} días</span>
                  ) : (
                    <span className="insignia-roja">{f.dias_vencida} días</span>
                  )}
                </td>
                <td className="text-right cifra">{montoSiempre(f.total)}</td>
                <td className="text-right cifra text-slate-500">
                  {montoSiempre(Number(f.cobrado) + Number(f.acreditado))}
                </td>
                <td className="text-right cifra font-semibold">{montoSiempre(f.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Los cobros «a cuenta» (sin factura específica) rebajan la cuenta contable del cliente pero no una factura puntual.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- recibos */

const FORMAS = [
  { clave: 'efectivo', titulo: 'Efectivo' },
  { clave: 'transferencia', titulo: 'Transferencia' },
  { clave: 'cheque', titulo: 'Cheque recibido' },
  { clave: 'tarjeta', titulo: 'Tarjeta' },
];

function TabRecibos() {
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [aviso, setAviso] = useState('');

  const cargar = () => api.get<Recibo[]>('/cxc/recibos').then(setRecibos).catch(() => setAviso('❌ Error cargando recibos'));
  useEffect(() => { void cargar(); }, []);

  async function anular(r: Recibo) {
    const motivo = prompt(`Motivo para anular el recibo ${r.numero_completo}:`);
    if (!motivo) return;
    setAviso('');
    try {
      await api.post(`/cxc/recibos/${r.id}/anular`, { motivo });
      setAviso(`✅ Recibo ${r.numero_completo} anulado`);
      await cargar();
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al anular'}`);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setMostrandoForm(!mostrandoForm)} className="boton-primario">
          {mostrandoForm ? 'Ocultar formulario' : '+ Nuevo recibo'}
        </button>
      </div>
      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {mostrandoForm && (
        <FormRecibo
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
            <tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Forma</th><th className="text-right">Total C$</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {recibos.length === 0 && (
              <tr><td colSpan={7} className="py-14 text-center text-slate-400">Sin recibos — el ciclo se cierra cobrando</td></tr>
            )}
            {recibos.map((r) => (
              <tr key={r.id} className={r.estado === 'anulado' ? 'opacity-50' : ''}>
                <td className="cifra font-medium">{r.numero_completo}</td>
                <td>{r.fecha.slice(0, 10)}</td>
                <td className="font-medium">{r.cliente}</td>
                <td className="text-slate-500 capitalize">{r.forma_pago}{r.referencia ? ` · ${r.referencia}` : ''}</td>
                <td className="text-right cifra font-medium">{montoSiempre(r.total)}</td>
                <td>
                  {r.estado === 'emitido'
                    ? <span className="insignia-verde">● emitido</span>
                    : <span className="insignia-roja">✕ anulado</span>}
                </td>
                <td className="text-right">
                  {r.estado === 'emitido' && (
                    <button onClick={() => void anular(r)} className="text-sm text-rojo hover:underline">Anular</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormRecibo({ alEmitir }: { alEmitir: (mensaje: string) => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [terceroId, setTerceroId] = useState('');
  const [pendientes, setPendientes] = useState<FacturaPendiente[]>([]);
  const [montos, setMontos] = useState<Record<number, string>>({});
  const [aCuenta, setACuenta] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [formaPago, setFormaPago] = useState('efectivo');
  const [referencia, setReferencia] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api.get<Cliente[]>('/clientes').then((c) => setClientes(c.filter((x) => x.activo))).catch(() => undefined);
  }, []);

  useEffect(() => {
    setPendientes([]);
    setMontos({});
    if (!terceroId) return;
    api
      .get<FacturaPendiente[]>(`/cxc/cartera/${terceroId}`)
      .then(setPendientes)
      .catch(() => setAviso('❌ Error cargando facturas del cliente'));
  }, [terceroId]);

  const total = useMemo(() => {
    let cent = 0;
    for (const v of Object.values(montos)) cent += Math.round(Number(v || 0) * 100);
    cent += Math.round(Number(aCuenta || 0) * 100);
    return cent / 100;
  }, [montos, aCuenta]);

  async function emitir() {
    setAviso('');
    const aplicaciones = [
      ...pendientes
        .filter((f) => Number(montos[f.id] || 0) > 0)
        .map((f) => ({ factura_id: f.id, monto: Number(montos[f.id]) })),
      ...(Number(aCuenta || 0) > 0 ? [{ factura_id: null, monto: Number(aCuenta) }] : []),
    ];
    if (aplicaciones.length === 0) {
      setAviso('❌ Indicá cuánto se aplica a cada factura (o un monto a cuenta)');
      return;
    }
    setOcupado(true);
    try {
      const recibo = await api.post<Recibo>('/cxc/recibos', {
        fecha,
        tercero_id: Number(terceroId),
        forma_pago: formaPago,
        referencia,
        aplicaciones,
      });
      alEmitir(`✅ Recibo ${recibo.numero_completo} emitido por C$ ${montoSiempre(recibo.total)}`);
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
          <label className="etiqueta">Cliente</label>
          <select value={terceroId} onChange={(e) => setTerceroId(e.target.value)} className="entrada">
            <option value="">— cliente —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="etiqueta">Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="entrada" />
        </div>
        <div>
          <label className="etiqueta">Forma de pago</label>
          <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className="entrada">
            {FORMAS.map((f) => <option key={f.clave} value={f.clave}>{f.titulo}</option>)}
          </select>
        </div>
        <div>
          <label className="etiqueta">Referencia (opcional)</label>
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)}
            placeholder="nº transferencia / cheque" className="entrada cifra" />
        </div>
      </div>

      {terceroId && (
        <>
          <label className="etiqueta">Aplicar a facturas pendientes</label>
          {pendientes.length === 0 ? (
            <p className="text-sm text-slate-400 mb-3">Este cliente no tiene facturas de crédito pendientes.</p>
          ) : (
            <table className="w-full text-sm mb-3">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 text-left">
                  <th className="pb-2">Factura</th><th className="pb-2">Fecha</th>
                  <th className="pb-2 text-right">Saldo</th><th className="pb-2 w-40 text-right">Monto a aplicar</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((f) => (
                  <tr key={f.id}>
                    <td className="py-1 cifra">{f.numero_completo}</td>
                    <td className="py-1">{f.fecha.slice(0, 10)}</td>
                    <td className="py-1 text-right cifra">{montoSiempre(f.saldo)}</td>
                    <td className="py-1 pl-3">
                      <div className="flex gap-1 items-center">
                        <input type="number" min="0" step="0.01" value={montos[f.id] ?? ''}
                          onChange={(e) => setMontos({ ...montos, [f.id]: e.target.value })}
                          placeholder="0.00" className="entrada text-right" />
                        <button type="button" title="Aplicar saldo completo"
                          onClick={() => setMontos({ ...montos, [f.id]: String(f.saldo) })}
                          className="text-xs font-semibold text-verde hover:text-verde-oscuro whitespace-nowrap">
                          todo
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div className="max-w-52">
              <label className="etiqueta">Cobro a cuenta (sin factura)</label>
              <input type="number" min="0" step="0.01" value={aCuenta}
                onChange={(e) => setACuenta(e.target.value)} placeholder="0.00" className="entrada text-right" />
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm">
                Total del recibo: <strong className="cifra text-lg text-verde-oscuro">{montoSiempre(total)}</strong>
              </span>
              <button onClick={() => void emitir()} disabled={total <= 0 || ocupado} className="boton-primario">
                Emitir recibo
              </button>
            </div>
          </div>
        </>
      )}
      {aviso && <p className="text-sm mt-3">{aviso}</p>}
    </div>
  );
}

/* ------------------------------------------------------- notas de crédito */

function TabNotas() {
  const [notas, setNotas] = useState<NotaCredito[]>([]);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [aviso, setAviso] = useState('');

  const cargar = () => api.get<NotaCredito[]>('/cxc/notas').then(setNotas).catch(() => setAviso('❌ Error cargando notas'));
  useEffect(() => { void cargar(); }, []);

  async function anular(n: NotaCredito) {
    const motivo = prompt(`Motivo para anular la nota ${n.numero_completo}:`);
    if (!motivo) return;
    setAviso('');
    try {
      await api.post(`/cxc/notas/${n.id}/anular`, { motivo });
      setAviso(`✅ Nota ${n.numero_completo} anulada`);
      await cargar();
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al anular'}`);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setMostrandoForm(!mostrandoForm)} className="boton-primario">
          {mostrandoForm ? 'Ocultar formulario' : '+ Nueva nota de crédito'}
        </button>
      </div>
      {aviso && <p className="text-sm mb-3">{aviso}</p>}

      {mostrandoForm && (
        <FormNota
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
            <tr><th>Número</th><th>Fecha</th><th>Factura</th><th>Cliente</th><th>Tipo</th>
            <th className="text-right">Total C$</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {notas.length === 0 && (
              <tr><td colSpan={8} className="py-14 text-center text-slate-400">Sin notas de crédito</td></tr>
            )}
            {notas.map((n) => (
              <tr key={n.id} className={n.estado === 'anulada' ? 'opacity-50' : ''}>
                <td className="cifra font-medium">{n.numero_completo}</td>
                <td>{n.fecha.slice(0, 10)}</td>
                <td className="cifra">{n.factura}</td>
                <td className="font-medium">{n.cliente}</td>
                <td className="text-slate-500 capitalize">{n.tipo === 'devolucion' ? 'devolución' : 'rebaja'}</td>
                <td className="text-right cifra font-medium">{montoSiempre(n.total)}</td>
                <td>
                  {n.estado === 'emitida'
                    ? <span className="insignia-verde">● emitida</span>
                    : <span className="insignia-roja">✕ anulada</span>}
                </td>
                <td className="text-right">
                  {n.estado === 'emitida' && (
                    <button onClick={() => void anular(n)} className="text-sm text-rojo hover:underline">Anular</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormNota({ alEmitir }: { alEmitir: (mensaje: string) => void }) {
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [facturaId, setFacturaId] = useState('');
  const [factura, setFactura] = useState<Factura | null>(null);
  const [tipo, setTipo] = useState<'devolucion' | 'rebaja'>('devolucion');
  const [cantidades, setCantidades] = useState<Record<number, string>>({});
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [tasaIva, setTasaIva] = useState(0.15);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api.get<{ facturas: Factura[] }>('/facturas?estado=emitida&por_pagina=200')
      .then((d) => setFacturas(d.facturas))
      .catch(() => undefined);
    api.get<Array<{ clave: string; valor: string }>>('/config')
      .then((cfg) => {
        const tasa = cfg.find((x) => x.clave === 'tasa_iva');
        if (tasa) setTasaIva(Number(tasa.valor));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setFactura(null);
    setCantidades({});
    if (!facturaId) return;
    api.get<Factura>(`/facturas/${facturaId}`).then(setFactura).catch(() => setAviso('❌ Error cargando factura'));
  }, [facturaId]);

  const subtotal = useMemo(() => {
    if (tipo === 'rebaja') return Number(monto || 0);
    let cent = 0;
    for (const l of factura?.lineas ?? []) {
      const c = Number(cantidades[l.id ?? -1] || 0);
      if (c > 0) cent += Math.round(c * Math.round(Number(l.precio_unitario) * 100));
    }
    return cent / 100;
  }, [tipo, monto, cantidades, factura]);

  const total = Math.round(subtotal * (1 + tasaIva) * 100) / 100;

  async function emitir() {
    setAviso('');
    setOcupado(true);
    try {
      const nota = await api.post<NotaCredito>('/cxc/notas', {
        factura_id: Number(facturaId),
        tipo,
        motivo,
        fecha,
        monto: tipo === 'rebaja' ? Number(monto) : undefined,
        lineas:
          tipo === 'devolucion'
            ? (factura?.lineas ?? [])
                .filter((l) => Number(cantidades[l.id ?? -1] || 0) > 0)
                .map((l) => ({ factura_linea_id: l.id, cantidad: Number(cantidades[l.id ?? -1]) }))
            : undefined,
      });
      alEmitir(`✅ Nota ${nota.numero_completo} emitida por C$ ${montoSiempre(nota.total)}`);
    } catch (e) {
      setAviso(`❌ ${e instanceof ErrorApi ? e.message : 'Error al emitir'}`);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="tarjeta p-6 mb-4">
      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <div>
          <label className="etiqueta">Factura</label>
          <select value={facturaId} onChange={(e) => setFacturaId(e.target.value)} className="entrada">
            <option value="">— factura emitida —</option>
            {facturas.map((f) => (
              <option key={f.id} value={f.id}>{f.numero_completo} · {f.cliente} · C$ {montoSiempre(f.total)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta">Tipo</label>
          <div className="inline-flex rounded-lg border border-borde bg-fondo p-1">
            {(['devolucion', 'rebaja'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTipo(t)}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition ${
                  tipo === t ? 'bg-white text-tinta shadow-sm border border-borde' : 'text-slate-500'
                }`}>
                {t === 'devolucion' ? 'Devolución' : 'Rebaja'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="etiqueta">Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="entrada" />
        </div>
      </div>

      {factura && tipo === 'devolucion' && (
        <div className="mb-4">
          <label className="etiqueta">Qué se devuelve</label>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 text-left">
                <th className="pb-2">Descripción</th><th className="pb-2 text-right">Facturado</th>
                <th className="pb-2 text-right">Precio</th><th className="pb-2 w-32 text-right">Cant. a devolver</th>
              </tr>
            </thead>
            <tbody>
              {(factura.lineas ?? []).map((l) => (
                <tr key={l.id}>
                  <td className="py-1">{l.descripcion}</td>
                  <td className="py-1 text-right cifra">{Number(l.cantidad)}</td>
                  <td className="py-1 text-right cifra">{montoSiempre(l.precio_unitario)}</td>
                  <td className="py-1 pl-3">
                    <input type="number" min="0" max={Number(l.cantidad)} step="0.01"
                      value={cantidades[l.id ?? -1] ?? ''}
                      onChange={(e) => setCantidades({ ...cantidades, [l.id ?? -1]: e.target.value })}
                      placeholder="0" className="entrada text-right" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-slate-400">La mercadería devuelta reingresa al inventario al costo con que salió.</p>
        </div>
      )}

      {factura && tipo === 'rebaja' && (
        <div className="mb-4 max-w-52">
          <label className="etiqueta">Monto de la rebaja (sin IVA)</label>
          <input type="number" min="0" step="0.01" value={monto}
            onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className="entrada text-right" />
        </div>
      )}

      <div className="mb-4">
        <label className="etiqueta">Motivo (obligatorio, queda en bitácora)</label>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
          placeholder="Producto dañado, error de precio…" className="entrada" />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <span className="text-sm text-slate-500">
          Subtotal {montoSiempre(subtotal)} + IVA {(tasaIva * 100).toFixed(0)}% →
          <strong className="cifra text-lg text-verde-oscuro ml-2">C$ {montoSiempre(total)}</strong>
        </span>
        <button onClick={() => void emitir()} disabled={!facturaId || !motivo || subtotal <= 0 || ocupado} className="boton-primario">
          Emitir nota de crédito
        </button>
      </div>
      {aviso && <p className="text-sm mt-3">{aviso}</p>}
    </div>
  );
}
