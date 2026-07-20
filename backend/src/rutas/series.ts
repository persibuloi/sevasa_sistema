import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

export const rutasSeries = Router();

rutasSeries.get('/', requierePermiso('facturacion', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query(
    `SELECT s.*, su.nombre AS sucursal_nombre
     FROM series s LEFT JOIN sucursales su ON su.codigo = s.sucursal
     ORDER BY s.serie`
  );
  res.json(r.rows);
}));

rutasSeries.post('/', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { serie, sucursal, tipo, prefijo, ultimo_numero } = req.body ?? {};
  if (!serie || !sucursal || !prefijo) {
    res.status(400).json({ error: 'serie, sucursal y prefijo son obligatorios' });
    return;
  }
  // Número inicial: para continuar el consecutivo del sistema viejo se indica
  // el ÚLTIMO número ya usado (el siguiente emitido será ese + 1)
  const inicial = Number(ultimo_numero ?? 0);
  if (!Number.isInteger(inicial) || inicial < 0) {
    res.status(400).json({ error: 'ultimo_numero debe ser un entero >= 0' });
    return;
  }
  const r = await pool.query(
    `INSERT INTO series (serie, sucursal, tipo, prefijo, ultimo_numero) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [serie, sucursal, tipo === 'manual' ? 'manual' : 'sistema', prefijo, inicial]
  );
  await registrarBitacora(pool, req.usuario!.id, 'crear_serie', 'series', serie, r.rows[0]);
  res.status(201).json(r.rows[0]);
}));

/** Mayor número YA usado por documentos de esta serie (según su tipo de documento). */
async function maximoUsado(serie: string, documento: string): Promise<number> {
  const tabla = documento === 'recibo' ? 'recibos' : documento === 'nota_credito' ? 'notas_credito' : 'facturas';
  const r = await pool.query(
    `SELECT COALESCE(MAX(numero), 0) AS maximo FROM ${tabla} WHERE serie = $1`,
    [serie]
  );
  return Number(r.rows[0]?.maximo ?? 0);
}

// Control de una serie: números grabados, anulados y HUECOS sin justificar
// (el sistema avisa pero no bloquea — contabilidad persigue el papel faltante)
rutasSeries.get('/:serie/control', requierePermiso('facturacion', 'ver'), envolver(async (req, res) => {
  const s = await pool.query('SELECT * FROM series WHERE serie = $1', [req.params.serie]);
  if (s.rowCount === 0) {
    res.status(404).json({ error: 'Serie no existe' });
    return;
  }
  const filas = await pool.query(
    `SELECT numero, estado FROM facturas WHERE serie = $1 AND numero IS NOT NULL ORDER BY numero`,
    [req.params.serie]
  );
  const usados = new Set(filas.rows.map((f) => Number(f.numero)));
  const maximo = filas.rows.length > 0 ? Number(filas.rows[filas.rows.length - 1].numero) : 0;
  const minimo = filas.rows.length > 0 ? Number(filas.rows[0].numero) : 0;
  const huecos: number[] = [];
  for (let n = minimo; n <= maximo && huecos.length < 200; n++) {
    if (!usados.has(n)) huecos.push(n);
  }
  res.json({
    serie: s.rows[0],
    emitidas: filas.rows.filter((f) => f.estado === 'emitida').length,
    anuladas: filas.rows.filter((f) => f.estado === 'anulada').length,
    borradores: filas.rows.filter((f) => f.estado === 'borrador').length,
    minimo,
    maximo,
    huecos,
  });
}));

rutasSeries.put('/:serie', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { sucursal, activa, ultimo_numero } = req.body ?? {};
  const antes = await pool.query('SELECT * FROM series WHERE serie = $1', [req.params.serie]);
  if (antes.rowCount === 0) {
    res.status(404).json({ error: 'Serie no existe' });
    return;
  }
  // Reinicializar el consecutivo: solo hacia adelante — NUNCA por debajo del
  // mayor número ya usado (chocaría con documentos existentes)
  let nuevoUltimo = Number(antes.rows[0].ultimo_numero);
  if (ultimo_numero !== undefined && ultimo_numero !== null && ultimo_numero !== '') {
    const solicitado = Number(ultimo_numero);
    if (!Number.isInteger(solicitado) || solicitado < 0) {
      res.status(400).json({ error: 'ultimo_numero debe ser un entero >= 0' });
      return;
    }
    const usado = await maximoUsado(req.params.serie ?? '', antes.rows[0].documento);
    if (solicitado < usado) {
      res.status(400).json({
        error: `No se puede bajar de ${usado}: ya hay documentos con ese número en la serie`,
      });
      return;
    }
    nuevoUltimo = solicitado;
  }
  const r = await pool.query(
    `UPDATE series SET sucursal = $2, activa = $3, ultimo_numero = $4 WHERE serie = $1 RETURNING *`,
    [req.params.serie, sucursal ?? antes.rows[0].sucursal, activa ?? antes.rows[0].activa, nuevoUltimo]
  );
  await registrarBitacora(pool, req.usuario!.id, 'editar_serie', 'series', req.params.serie, {
    antes: antes.rows[0],
    despues: r.rows[0],
  });
  res.json(r.rows[0]);
}));
