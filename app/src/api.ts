import { supabase } from './supabase';

export class ErrorApi extends Error {}

async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const r = await fetch(`/api${ruta}`, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opciones.headers ?? {}),
    },
  });
  const cuerpo: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const mensaje =
      cuerpo && typeof cuerpo === 'object' && 'error' in cuerpo
        ? String((cuerpo as { error: unknown }).error)
        : `Error ${r.status}`;
    throw new ErrorApi(mensaje);
  }
  return cuerpo as T;
}

export const api = {
  get: <T>(ruta: string) => pedir<T>(ruta),
  post: <T>(ruta: string, datos?: unknown) =>
    pedir<T>(ruta, { method: 'POST', body: JSON.stringify(datos ?? {}) }),
  put: <T>(ruta: string, datos?: unknown) =>
    pedir<T>(ruta, { method: 'PUT', body: JSON.stringify(datos ?? {}) }),
};
