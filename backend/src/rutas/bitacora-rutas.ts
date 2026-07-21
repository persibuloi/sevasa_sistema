import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';

/** Bitácora de auditoría: solo lectura, solo administradores. */
export const rutasBitacora = Router();

rutasBitacora.get('/filtros', requierePermiso('admin', 'ver'), envolver(async (_req, res) => {
  const acciones = await pool.query(`SELECT DISTINCT accion FROM bitacora ORDER BY accion`);
  const usuarios = await pool.query(
    `SELECT DISTINCT u.id, u.nombre FROM bitacora b JOIN usuarios u ON u.id = b.usuario_id ORDER BY u.nombre`
  );
  res.json({
    acciones: acciones.rows.map((r) => r.accion as string),
    usuarios: usuarios.rows,
  });
}));

rutasBitacora.get('/', requierePermiso('admin', 'ver'), envolver(async (req, res) => {
  const q = typeof req.query.q === 'string' && req.query.q.trim() !== '' ? `%${req.query.q.trim()}%` : null;
  const usuario = typeof req.query.usuario === 'string' && req.query.usuario !== '' ? req.query.usuario : null;
  const accion = typeof req.query.accion === 'string' && req.query.accion !== '' ? req.query.accion : null;
  const esFecha = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const desde = esFecha(req.query.desde) ? req.query.desde : null;
  const hasta = esFecha(req.query.hasta) ? req.query.hasta : null;
  const porPagina = Math.min(Math.max(Number(req.query.por_pagina ?? 50) || 50, 1), 200);
  const pagina = Math.max(Number(req.query.pagina ?? 1) || 1, 1);

  const filtros = `
    WHERE ($1::text IS NULL OR b.accion ILIKE $1 OR b.entidad ILIKE $1 OR b.detalle::text ILIKE $1)
      AND ($2::uuid IS NULL OR b.usuario_id = $2)
      AND ($3::text IS NULL OR b.accion = $3)
      AND ($4::date IS NULL OR b.en >= $4::date)
      AND ($5::date IS NULL OR b.en < ($5::date + 1))`;
  const parametros = [q, usuario, accion, desde, hasta];

  const total = await pool.query(`SELECT count(*)::int AS n FROM bitacora b ${filtros}`, parametros);
  const r = await pool.query(
    `SELECT b.id, b.en, b.accion, b.entidad, b.entidad_id, b.detalle,
            u.nombre AS usuario, u.email
     FROM bitacora b
     LEFT JOIN usuarios u ON u.id = b.usuario_id
     ${filtros}
     ORDER BY b.id DESC LIMIT $6 OFFSET $7`,
    [...parametros, porPagina, (pagina - 1) * porPagina]
  );
  res.json({ filas: r.rows, total: total.rows[0].n, pagina, por_pagina: porPagina });
}));
