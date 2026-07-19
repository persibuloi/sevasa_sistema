import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
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
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Cargando…</p>
      </div>
    );
  }

  return sesion ? <Sistema sesion={sesion} /> : <Login />;
}

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
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-slate-800 text-center">SEVASA Contable</h1>
        <p className="text-sm text-slate-500 text-center mt-1 mb-6">Sistema contable-financiero</p>

        <form className="space-y-4" onSubmit={entrar}>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="email">
              Correo
            </label>
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
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="clave">
              Contraseña
            </label>
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
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-lg bg-blue-600 text-white py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

const PAGINAS = [
  { clave: 'balanza', titulo: 'Balanza' },
  { clave: 'asientos', titulo: 'Asientos' },
  { clave: 'mayor', titulo: 'Libro mayor' },
  { clave: 'catalogo', titulo: 'Catálogo' },
  { clave: 'periodos', titulo: 'Períodos' },
] as const;

type Pagina = (typeof PAGINAS)[number]['clave'];

function Sistema({ sesion }: { sesion: Session }) {
  const [pagina, setPagina] = useState<Pagina>('balanza');

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-6">
          <h1 className="font-bold text-slate-800">SEVASA Contable</h1>
          <nav className="flex gap-1">
            {PAGINAS.map((p) => (
              <button
                key={p.clave}
                onClick={() => setPagina(p.clave)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  pagina === p.clave
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {p.titulo}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500">{sesion.user.email}</span>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-sm text-blue-600 hover:underline"
          >
            Salir
          </button>
        </div>
      </header>
      <main className="p-6">
        {pagina === 'balanza' && <Balanza />}
        {pagina === 'asientos' && <Asientos />}
        {pagina === 'mayor' && <Mayor />}
        {pagina === 'catalogo' && <Catalogo />}
        {pagina === 'periodos' && <Periodos />}
      </main>
    </div>
  );
}
