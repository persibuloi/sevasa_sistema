import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

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

  return sesion ? <Inicio sesion={sesion} /> : <Login />;
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
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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

function Inicio({ sesion }: { sesion: Session }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <h1 className="font-bold text-slate-800">SEVASA Contable</h1>
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
      <main className="p-8">
        <div className="bg-white rounded-xl shadow p-8 max-w-lg">
          <h2 className="text-lg font-semibold text-slate-800">✅ F0 — login funcionando</h2>
          <p className="text-sm text-slate-500 mt-2">
            Los módulos aparecerán aquí conforme avancen las fases: F1 contabilidad,
            F2 facturación y CxC, F3 bancos…
          </p>
        </div>
      </main>
    </div>
  );
}
