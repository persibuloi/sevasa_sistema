import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

let url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('❌ DATABASE_URL no configurada — copiar .env.example a .env y llenar');
}

// MODO PRUEBAS: si ESQUEMA_PRUEBAS está definido, todo el backend opera sobre
// ese esquema temporal (la base real ni se entera). Se usa el session pooler
// (puerto 5432) porque el transaction pooler no conserva SET search_path.
const esquemaPruebas = process.env.ESQUEMA_PRUEBAS;
if (esquemaPruebas) {
  if (!/^pruebas_[a-z0-9_]+$/.test(esquemaPruebas)) {
    throw new Error('❌ ESQUEMA_PRUEBAS debe llamarse pruebas_<algo>');
  }
  url = url.replace(':6543/', ':5432/');
}

export const pool = new Pool({
  connectionString: url,
  // Supabase exige TLS; en Postgres local (docker) no hay certificado
  ssl: url.includes('supabase.co') ? { rejectUnauthorized: false } : undefined,
  // 20-30 usuarios concurrentes: el pooler de Supabase multiplexa por
  // transacción, así que 10 conexiones del backend rinden de sobra.
  // El valor se valida: entero entre 1 y 50, si no → 10.
  max: (() => {
    const n = Number(process.env.PG_POOL_MAX ?? 10);
    return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 10;
  })(),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

if (esquemaPruebas) {
  // Cada conexión nueva del pool apunta al esquema de pruebas; el cliente pg
  // serializa sus consultas, así que este SET siempre corre primero
  pool.on('connect', (cliente) => {
    void cliente.query(`SET search_path TO ${esquemaPruebas}`);
  });
}

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