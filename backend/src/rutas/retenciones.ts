import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

/** Retenciones: catálogo de tipos (config) + reporte para la DGI. */
export const rutasRetenciones = Router();

/* ---------------------------------------------------------------- tipos */

// Leer: cualquiera autenticado (los formularios de compra/recibo lo necesitan)
rutasRetenciones.get('/tipos', envolver(async (_req, res) => {
  const r = await pool.query(
    `SELECT rt.*, c.nombre AS cuenta_nombre
     FROM retencion_tipos rt LEFT JOIN cuentas c ON c.codigo = rt.cuenta_contable
     ORDER BY rt.aplica, rt.codigo`
  );
  res.json(r.rows);
}));

rutasRetenciones.post('/tipos', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { codigo, nombre, tasa, base, cuenta_contable, aplica } = req.body ?? {};
  if (!codigo || !nombre || !cuenta_contable || !['compra', 'venta'].includes(aplica)) {
    res.status(400).json({ error: 'codigo, nombre, cuenta_contable y aplica (compra/venta) son obligatorios' });
    return;
  }
  const t = Number(tasa);
  if (!Number.isFinite(t) || t <= 0 || t >= 1) {
    res.status(400).json({ error: 'tasa debe ser una fracción entre 0 y 1 (ej. 0.02 para 2%)' });
    return;
  }
  const r = await pool.query(
    `INSERT INTO retencion_tipos (codigo, nombre, tasa, base, cuenta_contable, aplica, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [codigo, nombre, t, ['subtotal', 'iva', 'total'].includes(base) ? base : 'subtotal',
     cuenta_contable, aplica, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'crear_retencion_tipo', 'retencion_tipos', codigo, r.rows[0]);
  res.status(201).json(r.rows[0]);
}));

rutasRetenciones.put('/tipos/:codigo', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { nombre, tasa, base, cuenta_contable, activo } = req.body ?? {};
  const antes = await pool.query('SELECT * FROM retencion_tipos WHERE codigo = $1', [req.params.codigo]);
  if (antes.rowCount === 0) {
    res.status(404).json({ error: 'Tipo de retención no existe' });
    return;
  }
  const t = tasa !== undefined ? Number(tasa) : Number(antes.rows[0].tasa);
  if (!Number.isFinite(t) || t <= 0 || t >= 1) {
    res.status(400).json({ error: 'tasa inválida (fracción entre 0 y 1)' });
    return;
  }
  const r = await pool.query(
    `UPDATE retencion_tipos
     SET nombre = $2, tasa = $3, base = $4, cuenta_contable = $5, activo = $6,
         actualizado_por = $7, actualizado_en = now()
     WHERE codigo = $1 RETURNING *`,
    [req.params.codigo, nombre ?? antes.rows[0].nombre, t,
     ['subtotal', 'iva', 'total'].includes(base) ? base : antes.rows[0].base,
     cuenta_contable ?? antes.rows[0].cuenta_contable, activo ?? antes.rows[0].activo, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'editar_retencion_tipo', 'retencion_tipos', req.params.codigo, {
    antes: antes.rows[0],
    despues: r.rows[0],
  });
  res.json(r.rows[0]);
}));

/* ---------------------------------------------------------------- reporte */

// Retenciones EFECTUADAS (a proveedores): lo que SEVASA le debe a la DGI.
// Agrupado por tipo y tercero para la declaración mensual.
rutasRetenciones.get('/efectuadas', requierePermiso('contabilidad', 'ver'), envolver(async (req, res) => {
  const esFecha = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const desde = esFecha(req.query.desde) ? req.query.desde : null;
  const hasta = esFecha(req.query.hasta) ? req.query.hasta : null;
  const r = await pool.query(
    `SELECT cr.tipo_codigo, rt.nombre AS tipo_nombre, rt.tasa,
            c.tercero_id, t.nombre AS proveedor, t.ruc,
            SUM(cr.base) AS base, SUM(cr.monto) AS monto, count(*)::int AS documentos
     FROM compra_retenciones cr
     JOIN compras c        ON c.id = cr.compra_id AND c.estado = 'registrada'
     JOIN retencion_tipos rt ON rt.codigo = cr.tipo_codigo
     JOIN terceros t        ON t.id = c.tercero_id
     WHERE ($1::date IS NULL OR c.fecha >= $1) AND ($2::date IS NULL OR c.fecha <= $2)
     GROUP BY cr.tipo_codigo, rt.nombre, rt.tasa, c.tercero_id, t.nombre, t.ruc
     ORDER BY rt.nombre, t.nombre`,
    [desde, hasta]
  );
  const total = r.rows.reduce((s, f) => s + Number(f.monto), 0);
  res.json({ desde, hasta, filas: r.rows, total: Math.round(total * 100) / 100 });
}));

// Retenciones RECIBIDAS (que nos hicieron): anticipo IR acumulado.
// Hoy SEVASA es exento, pero el reporte queda disponible.
rutasRetenciones.get('/recibidas', requierePermiso('contabilidad', 'ver'), envolver(async (req, res) => {
  const esFecha = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const desde = esFecha(req.query.desde) ? req.query.desde : null;
  const hasta = esFecha(req.query.hasta) ? req.query.hasta : null;
  const r = await pool.query(
    `SELECT rr.tipo_codigo, rt.nombre AS tipo_nombre, rt.tasa,
            re.tercero_id, t.nombre AS cliente,
            SUM(rr.base) AS base, SUM(rr.monto) AS monto, count(*)::int AS documentos
     FROM recibo_retenciones rr
     JOIN recibos re        ON re.id = rr.recibo_id AND re.estado = 'emitido'
     JOIN retencion_tipos rt ON rt.codigo = rr.tipo_codigo
     JOIN terceros t        ON t.id = re.tercero_id
     WHERE ($1::date IS NULL OR re.fecha >= $1) AND ($2::date IS NULL OR re.fecha <= $2)
     GROUP BY rr.tipo_codigo, rt.nombre, rt.tasa, re.tercero_id, t.nombre
     ORDER BY rt.nombre, t.nombre`,
    [desde, hasta]
  );
  const total = r.rows.reduce((s, f) => s + Number(f.monto), 0);
  res.json({ desde, hasta, filas: r.rows, total: Math.round(total * 100) / 100 });
}));
