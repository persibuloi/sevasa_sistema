import type { Pool, PoolClient } from 'pg';

type Ejecutor = Pool | PoolClient;

/** Lee claves de la tabla config; falla claro si falta alguna. */
export async function leerConfig(bd: Ejecutor, claves: string[]): Promise<Record<string, string>> {
  const r = await bd.query('SELECT clave, valor FROM config WHERE clave = ANY($1)', [claves]);
  const mapa: Record<string, string> = {};
  for (const fila of r.rows) mapa[fila.clave] = fila.valor;
  for (const clave of claves) {
    if (!(clave in mapa)) throw new Error(`Falta la clave de configuración "${clave}" (tabla config)`);
  }
  return mapa;
}
