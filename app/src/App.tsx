import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import Facturas from './paginas/Facturas';
import Clientes from './paginas/Clientes';
import Productos from './paginas/Productos';
import Configuracion from './paginas/Configuracion';
import Catalogo from './paginas/Catalogo';
import Asientos from './paginas/Asientos';
import Balanza from './paginas/Balanza';
import Mayor from './paginas/Mayor';
import Periodos from './paginas/Periodos';

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

  return sesion ? <Sistema sesion={sesion} /> : <Login />;
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
      {/* Panel de marca */}
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

      {/* Formulario */}
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
      { clave: 'facturas', titulo: 'Facturas', trazos: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'] },
      { clave: 'clientes', titulo: 'Clientes', trazos: ['M16 21v-2a4 4 0 0 0-8 0v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M20 21v-2a3.5 3.5 0 0 0-2.5-3.4'] },
      { clave: 'productos', titulo: 'Productos', trazos: ['M21 8l-9-5-9 5v8l9 5 9-5V8z', 'M3.3 8.3L12 13l8.7-4.7', 'M12 13v9'] },
    ],
  },
  {
    titulo: 'Contabilidad',
    items: [
      { clave: 'balanza', titulo: 'Balanza', trazos: ['M12 3v18', 'M8 21h8', 'M4 7h16', 'M6 7l-2.5 6a3 3 0 0 0 5 0L6 7', 'M18 7l-2.5 6a3 3 0 0 0 5 0L18 7'] },
      { clave: 'asientos', titulo: 'Asientos', trazos: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'] },
      { clave: 'mayor', titulo: 'Libro mayor', trazos: ['M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z', 'M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z'] },
      { clave: 'catalogo', titulo: 'Catálogo', trazos: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'] },
      { clave: 'periodos', titulo: 'Períodos', trazos: ['M8 2v4', 'M16 2v4', 'M3 9h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'] },
    ],
  },
  {
    titulo: 'Administración',
    items: [
      { clave: 'configuracion', titulo: 'Configuración', trazos: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M12 2v2.5', 'M12 19.5V22', 'M2 12h2.5', 'M19.5 12H22', 'M4.6 4.6l1.8 1.8', 'M17.6 17.6l1.8 1.8', 'M19.4 4.6l-1.8 1.8', 'M6.4 17.6l-1.8 1.8'] },
    ],
  },
] as const;

type Pagina = (typeof GRUPOS)[number]['items'][number]['clave'];

const TITULOS: Record<Pagina, string> = {
  facturas: 'Facturación',
  clientes: 'Clientes',
  productos: 'Productos',
  balanza: 'Balanza de comprobación',
  asientos: 'Asientos contables',
  mayor: 'Libro mayor',
  catalogo: 'Catálogo de cuentas',
  periodos: 'Períodos contables',
  configuracion: 'Configuración',
};

function Sistema({ sesion }: { sesion: Session }) {
  const [pagina, setPagina] = useState<Pagina>('facturas');

  const hoy = new Date().toLocaleDateString('es-NI', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-tinta text-white flex flex-col sticky top-0 h-screen">
        <div className="px-5 pt-6 pb-4">
          <div className="text-xl font-extrabold tracking-tight leading-none">
            SEVASA
            <span className="block text-verde-suave/80 text-xs font-semibold tracking-[0.2em] uppercase mt-1">
              Contable
            </span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {GRUPOS.map((g) => (
            <div key={g.titulo} className="mt-4">
              <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                {g.titulo}
              </div>
              {g.items.map((item) => (
                <button
                  key={item.clave}
                  onClick={() => setPagina(item.clave)}
                  className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors mb-0.5 ${
                    pagina === item.clave
                      ? 'bg-verde text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]'
                      : 'text-white/65 hover:bg-tinta-claro hover:text-white'
                  }`}
                >
                  <Icono trazos={[...item.trazos]} />
                  {item.titulo}
                </button>
              ))}
            </div>
          ))}
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

      {/* Contenido */}
      <div className="flex-1 min-w-0">
        <header className="px-8 pt-7 pb-5 flex items-end justify-between flex-wrap gap-2">
          <h1 className="text-[26px] font-extrabold tracking-tight text-tinta">{TITULOS[pagina]}</h1>
          <span className="text-xs text-slate-400 capitalize">{hoy}</span>
        </header>
        <main className="px-8 pb-12">
          {pagina === 'facturas' && <Facturas />}
          {pagina === 'clientes' && <Clientes />}
          {pagina === 'productos' && <Productos />}
          {pagina === 'balanza' && <Balanza />}
          {pagina === 'asientos' && <Asientos />}
          {pagina === 'mayor' && <Mayor />}
          {pagina === 'catalogo' && <Catalogo />}
          {pagina === 'periodos' && <Periodos />}
          {pagina === 'configuracion' && <Configuracion />}
        </main>
      </div>
    </div>
  );
}
