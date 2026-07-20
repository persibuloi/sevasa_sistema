/**
 * PRUEBA DE CONCURRENCIA del consecutivo (el candado más crítico del sistema):
 * N clientes en paralelo tomando números de LA MISMA serie, como 20 vendedores
 * emitiendo facturas al mismo tiempo en una sucursal.
 *
 *   npm run prueba:carga
 *
 * Verifica: cero duplicados, cero huecos, último número exacto.
 * Usa una serie temporal PRUEBA-CARGA y la elimina al final.
 */
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const CLIENTES = 20;      // vendedores simultáneos
const POR_CLIENTE = 25;   // facturas que emite cada uno
const SERIE = 'PRUEBA-CARGA';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: CLIENTES,
});

async function emitirNumeros(cantidad: number): Promise<number[]> {
  const numeros: number[] = [];
  const cliente = await pool.connect();
  try {
    for (let i = 0; i < cantidad; i++) {
      await cliente.query('BEGIN');
      const r = await cliente.query(
        `UPDATE series SET ultimo_numero = ultimo_numero + 1
         WHERE serie = $1 AND activa RETURNING ultimo_numero`,
        [SERIE]
      );
      await cliente.query('COMMIT');
      numeros.push(Number(r.rows[0].ultimo_numero));
    }
  } finally {
    cliente.release();
  }
  return numeros;
}

async function correr(): Promise<void> {
  await pool.query('DELETE FROM series WHERE serie = $1', [SERIE]);
  await pool.query(
    `INSERT INTO series (serie, tipo, prefijo, documento) VALUES ($1, 'sistema', 'PC-', 'factura')`,
    [SERIE]
  );

  console.log(`🚀 ${CLIENTES} clientes × ${POR_CLIENTE} emisiones contra la serie ${SERIE}…`);
  const inicio = Date.now();
  const resultados = await Promise.all(
    Array.from({ length: CLIENTES }, () => emitirNumeros(POR_CLIENTE))
  );
  const ms = Date.now() - inicio;

  const todos = resultados.flat().sort((a, b) => a - b);
  const total = CLIENTES * POR_CLIENTE;
  const unicos = new Set(todos).size;
  const esperados = Array.from({ length: total }, (_, i) => i + 1);
  const huecos = esperados.filter((n) => !new Set(todos).has(n));
  const final = await pool.query('SELECT ultimo_numero FROM series WHERE serie = $1', [SERIE]);

  console.log(`✨ ${total} números emitidos en ${ms} ms (${Math.round((total / ms) * 1000)} emisiones/seg)`);
  console.log(`   Únicos: ${unicos}/${total} ${unicos === total ? '✅ sin duplicados' : '❌ ¡DUPLICADOS!'}`);
  console.log(`   Huecos: ${huecos.length} ${huecos.length === 0 ? '✅ consecutivo completo' : `❌ faltan ${huecos.slice(0, 10).join(', ')}`}`);
  console.log(`   Último número: ${final.rows[0].ultimo_numero} ${Number(final.rows[0].ultimo_numero) === total ? '✅ exacto' : '❌ no cuadra'}`);

  await pool.query('DELETE FROM series WHERE serie = $1', [SERIE]);
  console.log('🧹 Serie temporal eliminada');
}

correr()
  .then(() => pool.end())
  .catch((err) => {
    console.error('❌', err);
    process.exitCode = 1;
    return pool.end();
  });
