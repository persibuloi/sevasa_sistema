import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

export const rutasClientes = Router();

rutasClientes.get('/', requierePermiso('facturacion', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query(
    `SELECT t.*,
            COALESCE(f.facturas_emitidas, 0) AS facturas_emitidas
     FROM terceros t
     LEFT JOIN (
       SELECT tercero_id, count(*)::int AS facturas_emitidas
       FROM facturas WHERE estado = 'emitida' GROUP BY tercero_id
     ) f ON f.tercero_id = t.id
     WHERE t.tipo IN ('cliente', 'ambos')
     ORDER BY t.nombre`
  );
  res.json(r.rows);
}));

rutasClientes.post('/', requierePermiso('facturacion', 'crear'), envolver(async (req, res) => {
  const { ruc, nombre, terminos_dias } = req.body ?? {};
  if (!nombre) {
    res.status(400).json({ error: 'nombre es obligatorio' });
    return;
  }
  const r = await pool.query(
    `INSERT INTO terceros (ruc, nombre, tipo, terminos_dias, creado_por)
     VALUES ($1, $2, 'cliente', $3, $4) RETURNING *`,
    [ruc || null, nombre, Number(terminos_dias ?? 0), req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'crear_cliente', 'terceros', String(r.rows[0].id), { nombre });
  res.status(201).json(r.rows[0]);
}));

rutasClientes.put('/:id', requierePermiso('facturacion', 'editar'), envolver(async (req, res) => {
  const { ruc, nombre, terminos_dias, activo } = req.body ?? {};
  const antes = await pool.query(`SELECT * FROM terceros WHERE id = $1 AND tipo IN ('cliente','ambos')`, [req.params.id]);
  if (antes.rowCount === 0) {
    res.status(404).json({ error: 'Cliente no existe' });
    return;
  }
  const r = await pool.query(
    `UPDATE terceros
     SET ruc = $2, nombre = $3, terminos_dias = $4, activo = $5,
         actualizado_por = $6, actualizado_en = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, ruc || null, nombre ?? antes.rows[0].nombre,
     Number(terminos_dias ?? antes.rows[0].terminos_dias), activo ?? antes.rows[0].activo, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'editar_cliente', 'terceros', String(req.params.id), {
    antes: antes.rows[0],
    despues: r.rows[0],
  });
  res.json(r.rows[0]);
}));
