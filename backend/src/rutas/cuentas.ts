import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

export const rutasCuentas = Router();

rutasCuentas.get('/', requierePermiso('contabilidad', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query('SELECT * FROM cuentas ORDER BY codigo');
  res.json(r.rows);
}));

rutasCuentas.post('/', requierePermiso('contabilidad', 'crear'), envolver(async (req, res) => {
  const { codigo, nombre, tipo, padre, nivel, es_detalle, moneda } = req.body ?? {};
  if (!codigo || !nombre || !tipo) {
    res.status(400).json({ error: 'codigo, nombre y tipo son obligatorios' });
    return;
  }
  const r = await pool.query(
    `INSERT INTO cuentas (codigo, nombre, tipo, padre, nivel, es_detalle, moneda, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [codigo, nombre, tipo, padre ?? null, nivel ?? 1, es_detalle ?? true, moneda ?? 'NIO', req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'crear_cuenta', 'cuentas', codigo, { nuevo: r.rows[0] });
  res.status(201).json(r.rows[0]);
}));

const CAMPOS_EDITABLES = ['nombre', 'tipo', 'padre', 'nivel', 'es_detalle', 'moneda', 'activa'] as const;

rutasCuentas.put('/:codigo', requierePermiso('contabilidad', 'editar'), envolver(async (req, res) => {
  const codigo = req.params.codigo;
  const antes = await pool.query('SELECT * FROM cuentas WHERE codigo = $1', [codigo]);
  if (antes.rowCount === 0) {
    res.status(404).json({ error: `Cuenta ${codigo} no existe` });
    return;
  }
  const cambios: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (req.body && campo in req.body) cambios[campo] = req.body[campo];
  }
  if (Object.keys(cambios).length === 0) {
    res.status(400).json({ error: 'Nada que actualizar' });
    return;
  }
  const columnas = Object.keys(cambios);
  const valores = Object.values(cambios);
  const sets = columnas.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const r = await pool.query(
    `UPDATE cuentas SET ${sets}, actualizado_por = $${columnas.length + 2}, actualizado_en = now()
     WHERE codigo = $1 RETURNING *`,
    [codigo, ...valores, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'editar_cuenta', 'cuentas', codigo, {
    antes: antes.rows[0],
    despues: r.rows[0],
  });
  res.json(r.rows[0]);
}));
