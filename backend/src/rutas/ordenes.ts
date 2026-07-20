import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool, enTransaccion } from '../db';
import { envolver, aCentavos } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

/** Órdenes de compra: documento de CONTROL, sin efecto contable.
 *  Flujo: borrador → aprobada → recibida (al registrar la compra ligada). */
export const rutasOrdenes = Router();

interface LineaOC {
  producto_id?: number | null;
  descripcion: string;
  cantidad: number;
  costo_unitario: number;
}

function limpiarLineas(lineas: unknown): Array<LineaOC & { total: number }> | null {
  if (!Array.isArray(lineas) || lineas.length === 0) return null;
  const limpias: Array<LineaOC & { total: number }> = [];
  for (const l of lineas as LineaOC[]) {
    const cantidad = Number(l.cantidad);
    const costo = Number(l.costo_unitario ?? 0);
    if (!l.descripcion || !Number.isFinite(cantidad) || cantidad <= 0 || costo < 0) return null;
    limpias.push({
      producto_id: l.producto_id ?? null,
      descripcion: l.descripcion,
      cantidad,
      costo_unitario: costo,
      total: Math.round(cantidad * aCentavos(costo)) / 100,
    });
  }
  return limpias;
}

const SQL_LISTA = `
  SELECT o.*, t.nombre AS proveedor, b.nombre AS bodega_nombre,
         (SELECT COALESCE(SUM(total), 0) FROM orden_compra_lineas WHERE orden_id = o.id) AS total
  FROM ordenes_compra o
  JOIN terceros t ON t.id = o.tercero_id
  LEFT JOIN bodegas b ON b.codigo = o.bodega`;

rutasOrdenes.get('/', requierePermiso('compras', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query(`${SQL_LISTA} ORDER BY o.id DESC LIMIT 300`);
  res.json(r.rows);
}));

rutasOrdenes.get('/:id', requierePermiso('compras', 'ver'), envolver(async (req, res) => {
  const r = await pool.query(`${SQL_LISTA} WHERE o.id = $1`, [req.params.id]);
  if (r.rowCount === 0) {
    res.status(404).json({ error: 'Orden no existe' });
    return;
  }
  const lineas = await pool.query(
    `SELECT ol.*, p.codigo AS producto_codigo
     FROM orden_compra_lineas ol LEFT JOIN productos p ON p.id = ol.producto_id
     WHERE ol.orden_id = $1 ORDER BY ol.id`,
    [req.params.id]
  );
  res.json({ ...r.rows[0], lineas: lineas.rows });
}));

rutasOrdenes.post('/', requierePermiso('compras', 'crear'), envolver(async (req, res) => {
  const { tercero_id, fecha, bodega, lineas, notas } = req.body ?? {};
  if (!tercero_id || typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    res.status(400).json({ error: 'tercero_id y fecha (YYYY-MM-DD) son obligatorios' });
    return;
  }
  const limpias = limpiarLineas(lineas);
  if (!limpias) {
    res.status(400).json({ error: 'Líneas inválidas: descripción y cantidad > 0' });
    return;
  }
  const orden = await enTransaccion(async (bd: PoolClient) => {
    const o = await bd.query(
      `INSERT INTO ordenes_compra (tercero_id, fecha, bodega, notas, creado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tercero_id, fecha, bodega || null, notas || null, req.usuario!.id]
    );
    for (const l of limpias) {
      await bd.query(
        `INSERT INTO orden_compra_lineas (orden_id, producto_id, descripcion, cantidad, costo_unitario, total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [o.rows[0].id, l.producto_id, l.descripcion, l.cantidad, l.costo_unitario, l.total]
      );
    }
    return o.rows[0];
  });
  res.status(201).json(orden);
}));

rutasOrdenes.put('/:id', requierePermiso('compras', 'editar'), envolver(async (req, res) => {
  const { tercero_id, fecha, bodega, lineas, notas } = req.body ?? {};
  const actual = await pool.query('SELECT estado FROM ordenes_compra WHERE id = $1', [req.params.id]);
  if (actual.rowCount === 0) {
    res.status(404).json({ error: 'Orden no existe' });
    return;
  }
  if (actual.rows[0].estado !== 'borrador') {
    res.status(409).json({ error: 'Solo los borradores se editan' });
    return;
  }
  const limpias = limpiarLineas(lineas);
  if (!limpias) {
    res.status(400).json({ error: 'Líneas inválidas: descripción y cantidad > 0' });
    return;
  }
  const orden = await enTransaccion(async (bd: PoolClient) => {
    const o = await bd.query(
      `UPDATE ordenes_compra
       SET tercero_id = $2, fecha = $3, bodega = $4, notas = $5, actualizado_por = $6, actualizado_en = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, tercero_id, fecha, bodega || null, notas || null, req.usuario!.id]
    );
    await bd.query('DELETE FROM orden_compra_lineas WHERE orden_id = $1', [req.params.id]);
    for (const l of limpias) {
      await bd.query(
        `INSERT INTO orden_compra_lineas (orden_id, producto_id, descripcion, cantidad, costo_unitario, total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.params.id, l.producto_id, l.descripcion, l.cantidad, l.costo_unitario, l.total]
      );
    }
    return o.rows[0];
  });
  res.json(orden);
}));

rutasOrdenes.post('/:id/aprobar', requierePermiso('compras', 'crear'), envolver(async (req, res) => {
  const r = await pool.query(
    `UPDATE ordenes_compra SET estado = 'aprobada', actualizado_por = $2, actualizado_en = now()
     WHERE id = $1 AND estado = 'borrador' RETURNING *`,
    [req.params.id, req.usuario!.id]
  );
  if (r.rowCount === 0) {
    res.status(409).json({ error: 'La orden no existe o no está en borrador' });
    return;
  }
  await registrarBitacora(pool, req.usuario!.id, 'aprobar_orden_compra', 'ordenes_compra', String(req.params.id));
  res.json(r.rows[0]);
}));

rutasOrdenes.post('/:id/anular', requierePermiso('compras', 'anular'), envolver(async (req, res) => {
  const { motivo } = req.body ?? {};
  if (!motivo) {
    res.status(400).json({ error: 'Anular exige un motivo' });
    return;
  }
  const r = await pool.query(
    `UPDATE ordenes_compra SET estado = 'anulada', actualizado_por = $2, actualizado_en = now()
     WHERE id = $1 AND estado IN ('borrador', 'aprobada') RETURNING *`,
    [req.params.id, req.usuario!.id]
  );
  if (r.rowCount === 0) {
    res.status(409).json({ error: 'La orden no existe o ya fue recibida/anulada' });
    return;
  }
  await registrarBitacora(pool, req.usuario!.id, 'anular_orden_compra', 'ordenes_compra', String(req.params.id), { motivo });
  res.json(r.rows[0]);
}));
