import { useEffect, useState, type FormEvent } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import Facturas from './paginas/Facturas';
import Clientes from './paginas/Clientes';
import Productos from './paginas/Productos';
import Cobranza from './paginas/Cobranza';
import Compras from './paginas/Compras';
import Traslados from './paginas/Traslados';
import Polizas from './paginas/Polizas';
import Bancos from './paginas/Bancos';
import Catalogo from './paginas/Catalogo';
import Asientos from './paginas/Asientos';
import Balanza from './paginas/Balanza';
import Mayor from './paginas/Mayor';
import Periodos from './paginas/Periodos';
import Retenciones from './paginas/Retenciones';
import EstadosFinancieros from './paginas/EstadosFinancieros';
import Configuracion from './paginas/Configuracion';
import Bitacora from './paginas/Bitacora';
import Usuarios from './paginas/Usuarios';
import SaldosIniciales from './paginas/SaldosIniciales';
import Permisos from './paginas/Permisos';
import { api } from './api';

export default function App() {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session);
      setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => setSesion(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-400 text-sm">Cargando…</p>
      </div>
    );
  }

  return sesion ? (
    <BrowserRouter>
      <Sistema sesion={sesion} />
    </BrowserRouter>
  ) : (
    <Login />
  );
}

/* ---------------------------------------------------------------- login */

function Login() {
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: clave });
    setEnviando(false);
    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'Correo o contraseña incorrectos'
          : error.message
      );
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <div
        className="hidden lg:flex flex-col justify-between bg-tinta text-white p-12 relative overflow-hidden"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      >
        <div className="font-mono text-xs tracking-[0.25em] text-white/40">SISTEMA CONTABLE-FINANCIERO</div>
        <div>
          <h1 className="text-6xl font-extrabold tracking-tight leading-none">
            SEVASA
            <span className="block text-verde-suave/90 text-3xl font-semibold mt-2">Contable</span>
          </h1>
          <p className="mt-6 text-white/60 max-w-sm text-sm leading-relaxed">
            Partida doble con candados en la base de datos: ningún asiento descuadrado,
            ningún período cerrado se toca, ningún número de factura se repite.
          </p>
        </div>
        <div className="font-mono text-xs text-white/30 cifra">
          DEBE&nbsp;=&nbsp;HABER&nbsp;· al centavo
        </div>
        <div className="absolute -right-24 -bottom-28 text-[26rem] leading-none font-extrabold text-white/[0.04] select-none pointer-events-none cifra">
          ¢
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 text-center">
            <h1 className="text-3xl font-extrabold text-tinta">SEVASA <span className="text-verde">Contable</span></h1>
          </div>
          <h2 className="text-2xl font-bold text-tinta mb-1">Bienvenido</h2>
          <p className="text-sm text-slate-500 mb-8">Iniciá sesión con tu cuenta del sistema</p>

          <form className="space-y-5" onSubmit={entrar}>
            <div>
              <label className="etiqueta" htmlFor="email">Correo</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="entrada"
                placeholder="usuario@sevasa.com"
              />
            </div>
            <div>
              <label className="etiqueta" htmlFor="clave">Contraseña</label>
              <input
                id="clave"
                type="password"
                required
                autoComplete="current-password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                className="entrada"
              />
            </div>
            {error && <p className="text-sm text-rojo">{error}</p>}
            <button type="submit" disabled={enviando} className="boton-primario w-full py-2.5">
              {enviando ? 'Entrando…' : 'Entrar al sistema'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shell */

function Icono({ trazos }: { trazos: string[] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-[18px] h-[18px] shrink-0"
    >
      {trazos.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

const GRUPOS = [
  {
    titulo: 'Ventas',
    items: [
      { ruta: '/facturas', titulo: 'Facturas', trazos: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'] },
      { ruta: '/clientes', titulo: 'Clientes', trazos: ['M16 21v-2a4 4 0 0 0-8 0v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M20 21v-2a3.5 3.5 0 0 0-2.5-3.4'] },
      { ruta: '/productos', titulo: 'Productos', trazos: ['M21 8l-9-5-9 5v8l9 5 9-5V8z', 'M3.3 8.3L12 13l8.7-4.7', 'M12 13v9'] },
      { ruta: '/cobranza', titulo: 'Cobranza', trazos: ['M3 7h18v12H3z', 'M3 7l2-3h14l2 3', 'M16 13h.01'],
        subs: [
          { ruta: '/cobranza/cartera', titulo: 'Cartera' },
          { ruta: '/cobranza/recibos', titulo: 'Recibos de cobro' },
          { ruta: '/cobranza/notas', titulo: 'Notas de crédito' },
        ] },
    ],
  },
  {
    titulo: 'Compras e inventario',
    items: [
      { ruta: '/compras', titulo: 'Compras', trazos: ['M6 6h15l-1.5 9H7.5z', 'M6 6L5 2H2', 'M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
        subs: [
          { ruta: '/compras/compras', titulo: 'Compras' },
          { ruta: '/compras/ordenes', titulo: 'Órdenes de compra' },
          { ruta: '/compras/proveedores', titulo: 'Proveedores' },
        ] },
      { ruta: '/traslados', titulo: 'Traslados', trazos: ['M17 3l4 4-4 4', 'M21 7H8', 'M7 21l-4-4 4-4', 'M3 17h13'] },
      { ruta: '/polizas', titulo: 'Pólizas import.', trazos: ['M2 12h20', 'M12 2a15 15 0 0 1 0 20', 'M12 2a15 15 0 0 0 0 20', 'M12 2v20'] },
    ],
  },
  {
    titulo: 'Tesorería',
    items: [
      { ruta: '/bancos', titulo: 'Bancos y cheques', trazos: ['M3 21h18', 'M4 18h16', 'M5 18V9M9.5 18V9M14.5 18V9M19 18V9', 'M2 9l10-6 10 6z'],
        subs: [
          { ruta: '/bancos/movimientos', titulo: 'Movimientos' },
          { ruta: '/bancos/conciliacion', titulo: 'Conciliación' },
          { ruta: '/bancos/cuentas', titulo: 'Cuentas bancarias' },
        ] },
    ],
  },
  {
    titulo: 'Contabilidad',
    items: [
      { ruta: '/estados', titulo: 'Estados financieros', trazos: ['M3 3v18h18', 'M7 15l4-5 3 3 5-7'],
        subs: [
          { ruta: '/estados/balance', titulo: 'Balance General' },
          { ruta: '/estados/resultados', titulo: 'Estado de Resultados' },
        ] },
      { ruta: '/balanza', titulo: 'Balanza', trazos: ['M12 3v18', 'M8 21h8', 'M4 7h16', 'M6 7l-2.5 6a3 3 0 0 0 5 0L6 7', 'M18 7l-2.5 6a3 3 0 0 0 5 0L18 7'] },
      { ruta: '/asientos', titulo: 'Asientos', trazos: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'] },
      { ruta: '/mayor', titulo: 'Libro mayor', trazos: ['M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z', 'M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z'] },
      { ruta: '/catalogo', titulo: 'Catálogo', trazos: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'] },
      { ruta: '/periodos', titulo: 'Períodos', trazos: ['M8 2v4', 'M16 2v4', 'M3 9h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'] },
      { ruta: '/retenciones', titulo: 'Retenciones', trazos: ['M12 2v20', 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'] },
      { ruta: '/saldos-iniciales', titulo: 'Saldos iniciales', trazos: ['M21 8v13H3V8', 'M1 3h22v5H1z', 'M10 12h4'] },
    ],
  },
  {
    titulo: 'Administración',
    items: [
      { ruta: '/configuracion', titulo: 'Configuración', trazos: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M12 2v2.5', 'M12 19.5V22', 'M2 12h2.5', 'M19.5 12H22', 'M4.6 4.6l1.8 1.8', 'M17.6 17.6l1.8 1.8', 'M19.4 4.6l-1.8 1.8', 'M6.4 17.6l-1.8 1.8'],
        subs: [
          { ruta: '/configuracion/sucursales', titulo: 'Sucursales' },
          { ruta: '/configuracion/bodegas', titulo: 'Bodegas' },
          { ruta: '/configuracion/vendedores', titulo: 'Vendedores' },
          { ruta: '/configuracion/series', titulo: 'Series de factura' },
          { ruta: '/configuracion/parametros', titulo: 'Parámetros' },
        ] },
      { ruta: '/usuarios', titulo: 'Usuarios', trazos: ['M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2', 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M21 21v-2a4 4 0 0 0-3-3.85', 'M16 3.15A4 4 0 0 1 16 11'] },
      { ruta: '/permisos', titulo: 'Roles y permisos', trazos: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'] },
      { ruta: '/bitacora', titulo: 'Bitácora', trazos: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5'] },
    ],
  },
] as const;

interface SubItem {
  ruta: string;
  titulo: string;
}

/** Qué módulo de permisos gobierna cada ruta del menú. El menú solo muestra
 *  las rutas cuyos módulos el usuario puede VER (GET /api/yo trae la lista);
 *  el backend rechaza igual aunque alguien escriba la URL a mano. */
const RUTA_MODULO: Record<string, string> = {
  '/facturas': 'facturacion',
  '/clientes': 'cxc',
  '/productos': 'inventario',
  '/cobranza': 'cxc',
  '/compras': 'compras',
  '/traslados': 'inventario',
  '/polizas': 'polizas',
  '/bancos': 'bancos',
  '/balanza': 'contabilidad',
  '/asientos': 'contabilidad',
  '/mayor': 'contabilidad',
  '/catalogo': 'contabilidad',
  '/periodos': 'contabilidad',
  '/retenciones': 'contabilidad',
  '/estados': 'contabilidad',
  '/saldos-iniciales': 'contabilidad',
  '/configuracion': 'admin',
  '/usuarios': 'admin',
  '/permisos': 'admin',
  '/bitacora': 'admin',
};

const TITULOS: Record<string, string> = {
  '/facturas': 'Facturación',
  '/clientes': 'Clientes',
  '/productos': 'Productos',
  '/cobranza': 'Cobranza y cartera',
  '/compras': 'Compras',
  '/traslados': 'Traslados entre bodegas',
  '/polizas': 'Pólizas de importación',
  '/bancos': 'Bancos y cheques',
  '/balanza': 'Balanza de comprobación',
  '/asientos': 'Asientos contables',
  '/mayor': 'Libro mayor',
  '/catalogo': 'Catálogo de cuentas',
  '/periodos': 'Períodos contables',
  '/retenciones': 'Retenciones',
  '/estados': 'Estados financieros',
  '/configuracion': 'Configuración',
  '/bitacora': 'Bitácora de auditoría',
  '/usuarios': 'Usuarios',
  '/permisos': 'Roles y permisos',
  '/saldos-iniciales': 'Saldos iniciales (apertura)',
};

function Encabezado({ alAbrirMenu }: { alAbrirMenu: () => void }) {
  const { pathname } = useLocation();
  const base = `/${pathname.split('/')[1] ?? ''}`;
  const hoy = new Date().toLocaleDateString('es-NI', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return (
    <header className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 pt-4 sm:px-8 sm:pb-5 sm:pt-7">
      <div className="flex min-w-0 items-center gap-3">
        {/* En celular el menú vive detrás de este botón */}
        <button
          onClick={alAbrirMenu}
          aria-label="Abrir menú"
          className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-borde bg-white text-tinta lg:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <h1 className="truncate text-[20px] font-extrabold tracking-tight text-tinta sm:text-[26px]">
          {TITULOS[base] ?? 'SEVASA Contable'}
        </h1>
      </div>
      <span className="hidden text-xs capitalize text-slate-400 sm:inline">{hoy}</span>
    </header>
  );
}

function Sistema({ sesion }: { sesion: Session }) {
  const { pathname } = useLocation();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [modulos, setModulos] = useState<string[] | null>(null);

  // Al navegar en celular, el menú se cierra solo
  useEffect(() => setMenuAbierto(false), [pathname]);

  // La sesión trae los módulos que este usuario puede VER
  useEffect(() => {
    api.get<{ modulos?: string[] }>('/yo')
      .then((yo) => setModulos(yo.modulos ?? []))
      .catch(() => setModulos([]));
  }, []);

  const puedeVer = (ruta: string): boolean => {
    if (modulos === null) return true; // cargando: no parpadear
    const modulo = RUTA_MODULO[ruta];
    return !modulo || modulos.includes(modulo);
  };

  // Guardia: si escribieron a mano una ruta que no les toca, a su primera pantalla
  const base = `/${pathname.split('/')[1] ?? ''}`;
  const todasLasRutas: string[] = (GRUPOS as ReadonlyArray<{ items: ReadonlyArray<{ ruta: string }> }>)
    .flatMap((g) => g.items.map((i) => i.ruta));
  const primeraPermitida = todasLasRutas.find((r) => puedeVer(r)) ?? '/facturas';
  if (modulos !== null && RUTA_MODULO[base] && !puedeVer(base)) {
    return <Navigate to={primeraPermitida} replace />;
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* Fondo que cierra el menú en celular */}
      {menuAbierto && (
        <div
          onClick={() => setMenuAbierto(false)}
          className="fixed inset-0 z-40 bg-tinta/50 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-60 shrink-0 flex-col bg-tinta text-white
                    transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:translate-x-0
                    ${menuAbierto ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-5 pt-6 pb-4">
          <div className="text-xl font-extrabold tracking-tight leading-none">
            SEVASA
            <span className="block text-verde-suave/80 text-xs font-semibold tracking-[0.2em] uppercase mt-1">
              Contable
            </span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {GRUPOS.map((g) => {
            const visibles = g.items.filter((i) => puedeVer(i.ruta));
            if (visibles.length === 0) return null; // grupo sin nada que mostrar
            return (
            <div key={g.titulo} className="mt-4">
              <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                {g.titulo}
              </div>
              {visibles.map((item) => {
                const subs: readonly SubItem[] = 'subs' in item ? item.subs : [];
                const abierto = pathname.startsWith(item.ruta);
                return (
                  <div key={item.ruta}>
                    <NavLink
                      to={item.ruta}
                      className={({ isActive }) =>
                        `w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors mb-0.5 ${
                          isActive
                            ? 'bg-verde text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]'
                            : 'text-white/65 hover:bg-tinta-claro hover:text-white'
                        }`
                      }
                    >
                      <Icono trazos={[...item.trazos]} />
                      {item.titulo}
                    </NavLink>
                    {subs.length > 0 && abierto && (
                      <div className="ml-[26px] border-l border-tinta-borde pl-2 mb-1.5 mt-0.5">
                        {subs.map((s) => (
                          <NavLink
                            key={s.ruta}
                            to={s.ruta}
                            className={({ isActive }) =>
                              `block rounded-md px-2 py-1.5 text-[12px] transition-colors ${
                                isActive
                                  ? 'text-white font-semibold bg-tinta-claro'
                                  : 'text-white/45 hover:text-white'
                              }`
                            }
                          >
                            {s.titulo}
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            );
          })}
        </nav>

        <div className="border-t border-tinta-borde px-5 py-4">
          <div className="text-xs text-white/70 truncate">{sesion.user.email}</div>
          <button
            onClick={() => supabase.auth.signOut()}
            className="mt-1 text-xs font-semibold text-verde-suave/80 hover:text-white transition-colors"
          >
            Cerrar sesión →
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <Encabezado alAbrirMenu={() => setMenuAbierto(true)} />
        <main className="px-4 pb-12 sm:px-8">
          <Routes>
            <Route path="/" element={<Navigate to="/facturas" replace />} />
            <Route path="/facturas" element={<Facturas />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/productos" element={<Productos />} />
            <Route path="/cobranza" element={<Navigate to="/cobranza/cartera" replace />} />
            <Route path="/cobranza/:pestana" element={<Cobranza />} />
            <Route path="/compras" element={<Navigate to="/compras/compras" replace />} />
            <Route path="/compras/:pestana" element={<Compras />} />
            <Route path="/traslados" element={<Traslados />} />
            <Route path="/polizas" element={<Polizas />} />
            <Route path="/bancos" element={<Navigate to="/bancos/movimientos" replace />} />
            <Route path="/bancos/:pestana" element={<Bancos />} />
            <Route path="/balanza" element={<Balanza />} />
            <Route path="/asientos" element={<Asientos />} />
            <Route path="/mayor" element={<Mayor />} />
            <Route path="/catalogo" element={<Catalogo />} />
            <Route path="/periodos" element={<Periodos />} />
            <Route path="/retenciones" element={<Retenciones />} />
            <Route path="/estados" element={<Navigate to="/estados/balance" replace />} />
            <Route path="/estados/:pestana" element={<EstadosFinancieros />} />
            <Route path="/configuracion" element={<Navigate to="/configuracion/sucursales" replace />} />
            <Route path="/configuracion/:pestana" element={<Configuracion />} />
            <Route path="/bitacora" element={<Bitacora />} />
            <Route path="/usuarios" element={<Usuarios />} />
            <Route path="/saldos-iniciales" element={<SaldosIniciales />} />
            <Route path="/permisos" element={<Permisos />} />
            <Route path="*" element={<Navigate to="/facturas" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
