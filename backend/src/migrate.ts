/**
 * Runner de migraciones: aplica migrations/*.sql en orden numérico,
 * cada una dentro de su propia transacción, y registra lo aplicado
 * en _migraciones. Reproducible desde cero (criterio de F0).
 *
 *   npm run migrate
 */
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './db';

const CARPETA = path.resolve(__dirname, '..', '..', 'migrations');

async function migrar(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migraciones (
      nombre      text PRIMARY KEY,
      aplicada_en timestamptz NOT NULL DEFAULT now()
    )`);

  const aplicadas = new Set(
    (await pool.query('SELECT nombre FROM _migraciones')).rows.map((r) => r.nombre as string)
  );

  const archivos = fs
    .readdirSync(CARPETA)
    .filter((a) => a.endsWith('.sql'))
    .sort();

  let nuevas = 0;
  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) continue;
    const sql = fs.readFileSync(path.join(CARPETA, archivo), 'utf8');
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(sql);
      await cliente.query('INSERT INTO _migraciones (nombre) VALUES ($1)', [archivo]);
      await cliente.query('COMMIT');
      console.log(`✅ ${archivo}`);
      nuevas++;
    } catch (err) {
      await cliente.query('ROLLBACK');
      console.error(`❌ ${archivo} falló — rollback completo:`);
      throw err;
    } finally {
      cliente.release();
    }
  }
  console.log(nuevas === 0 ? '✨ Base al día — nada que aplicar' : `✨ ${nuevas} migración(es) aplicada(s)`);
}

migrar()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
    return pool.end();
  });