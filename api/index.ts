/**
 * Entrypoint serverless para Vercel: toda petición /api/* llega aquí
 * (rewrite en vercel.json) y la atiende la misma app de Express del
 * backend — mismas rutas, mismos permisos, mismos candados.
 *
 * Variables de entorno requeridas en Vercel (ver CLAUDE.md → Deploy):
 * DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, CORS_ORIGEN, PG_POOL_MAX.
 */
import { app } from '../backend/src/aplicacion';

export default app;
