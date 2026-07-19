import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const llave = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !llave) {
  throw new Error('❌ Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — ver app/.env.example');
}

export const supabase = createClient(url, llave);
