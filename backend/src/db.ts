import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('❌ DATABASE_URL no configurada — copiar .env.example a .env y llenar');
}

export const pool = new Pool({
  connectionString: url,
  // Supabase exige TLS; en Postgres local (docker) no hay certificado
  ssl: url.includes('supabase.co') ? { rejectUnauthorized: false } : undefined,
  // 20-30 usuarios concurrentes: el pooler de Supabase multiplexa por
  // transacción, así que 10 conexiones del backend rinden de sobra
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

/** Ejecuta fn dentro de una transacción; rollback automático si lanza.
 *  TODA escritura contable (documento + asiento + movimientos) pasa por aquí. */
export async function enTransaccion<T>(
  fn: (cliente: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }
}