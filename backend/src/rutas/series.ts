import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

export const rutasSeries = Router();

rutasSeries.get('/', requierePermiso('facturacion', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query('SELECT * FROM series ORDER BY serie');
  res.json(r.rows);
}));

rutasSeries.post('/', requierePermiso('facturacion', 'editar'), envolver(async (req, res) => {
  const { serie, tienda, tipo, prefijo } = req.body ?? {};
  if (!serie || !tienda || !prefijo) {
    res.status(400).json({ error: 'serie, tienda y prefijo son obligatorios' });
    return;
  }
  const r = await pool.query(
    `INSERT INTO series (serie, tienda, tipo, prefijo) VALUES ($1, $2, $3, $4) RETURNING *`,
    [serie, tienda, tipo === 'manual' ? 'manual' : 'sistema', prefijo]
  );
  await registrarBitacora(pool, req.usuario!.id, 'crear_serie', 'series', serie, r.rows[0]);
  res.status(201).json(r.rows[0]);
}));

rutasSeries.put('/:serie', requierePermiso('facturacion', 'editar'), envolver(async (req, res) => {
  const { tienda, activa } = req.body ?? {};
  const antes = await pool.query('SELECT * FROM series WHERE serie = $1', [req.params.serie]);
  if (antes.rowCount === 0) {
    res.status(404).json({ error: 'Serie no existe' });
    return;
  }
  const r = await pool.query(
    `UPDATE series SET tienda = $2, activa = $3 WHERE serie = $1 RETURNING *`,
    [req.params.serie, tienda ?? antes.rows[0].tienda, activa ?? antes.rows[0].activa]
  );
  await registrarBitacora(pool, req.usuario!.id, 'editar_serie', 'series', req.params.serie, {
    antes: antes.rows[0],
    despues: r.rows[0],
  });
  res.json(r.rows[0]);
}));
