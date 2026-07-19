import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

export const rutasPeriodos = Router();

rutasPeriodos.get('/', requierePermiso('contabilidad', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query('SELECT * FROM periodos ORDER BY ano_mes DESC');
  res.json(r.rows);
}));

rutasPeriodos.post('/', requierePermiso('contabilidad', 'crear'), envolver(async (req, res) => {
  const { ano_mes } = req.body ?? {};
  if (!ano_mes || !/^\d{4}-\d{2}$/.test(ano_mes)) {
    res.status(400).json({ error: 'ano_mes inválido (formato YYYY-MM)' });
    return;
  }
  const r = await pool.query('INSERT INTO periodos (ano_mes) VALUES ($1) RETURNING *', [ano_mes]);
  await registrarBitacora(pool, req.usuario!.id, 'abrir_periodo', 'periodos', ano_mes);
  res.status(201).json(r.rows[0]);
}));

rutasPeriodos.post('/:anoMes/cerrar', requierePermiso('contabilidad', 'cerrar'), envolver(async (req, res) => {
  const anoMes = req.params.anoMes;
  const r = await pool.query(
    `UPDATE periodos SET estado = 'cerrado', cerrado_por = $2, cerrado_en = now()
     WHERE ano_mes = $1 AND estado = 'abierto' RETURNING *`,
    [anoMes, req.usuario!.id]
  );
  if (r.rowCount === 0) {
    res.status(409).json({ error: `El período ${anoMes} no existe o ya está cerrado` });
    return;
  }
  await registrarBitacora(pool, req.usuario!.id, 'cerrar_periodo', 'periodos', anoMes);
  res.json(r.rows[0]);
}));

rutasPeriodos.post('/:anoMes/reabrir', requierePermiso('contabilidad', 'cerrar'), envolver(async (req, res) => {
  const anoMes = req.params.anoMes;
  const { motivo } = req.body ?? {};
  if (!motivo) {
    res.status(400).json({ error: 'Reabrir un período exige un motivo (queda en bitácora)' });
    return;
  }
  const r = await pool.query(
    `UPDATE periodos SET estado = 'abierto', cerrado_por = NULL, cerrado_en = NULL
     WHERE ano_mes = $1 AND estado = 'cerrado' RETURNING *`,
    [anoMes]
  );
  if (r.rowCount === 0) {
    res.status(409).json({ error: `El período ${anoMes} no existe o no está cerrado` });
    return;
  }
  await registrarBitacora(pool, req.usuario!.id, 'reabrir_periodo', 'periodos', anoMes, { motivo });
  res.json(r.rows[0]);
}));
