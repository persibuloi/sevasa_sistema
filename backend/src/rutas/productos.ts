import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

export const rutasProductos = Router();

rutasProductos.get('/', requierePermiso('facturacion', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query('SELECT * FROM productos ORDER BY codigo');
  res.json(r.rows);
}));

rutasProductos.post('/', requierePermiso('facturacion', 'editar'), envolver(async (req, res) => {
  const { codigo, nombre, unidad, categoria, precio_venta } = req.body ?? {};
  if (!codigo || !nombre) {
    res.status(400).json({ error: 'codigo y nombre son obligatorios' });
    return;
  }
  const precio = Number(precio_venta ?? 0);
  if (!Number.isFinite(precio) || precio < 0) {
    res.status(400).json({ error: 'precio_venta inválido' });
    return;
  }
  const r = await pool.query(
    `INSERT INTO productos (codigo, nombre, unidad, categoria, precio_venta, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [codigo, nombre, unidad || 'unidad', categoria || null, precio, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'crear_producto', 'productos', codigo, r.rows[0]);
  res.status(201).json(r.rows[0]);
}));

rutasProductos.put('/:id', requierePermiso('facturacion', 'editar'), envolver(async (req, res) => {
  const { nombre, unidad, categoria, precio_venta, activo } = req.body ?? {};
  const antes = await pool.query('SELECT * FROM productos WHERE id = $1', [req.params.id]);
  if (antes.rowCount === 0) {
    res.status(404).json({ error: 'Producto no existe' });
    return;
  }
  const r = await pool.query(
    `UPDATE productos
     SET nombre = $2, unidad = $3, categoria = $4, precio_venta = $5, activo = $6,
         actualizado_por = $7, actualizado_en = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, nombre ?? antes.rows[0].nombre, unidad ?? antes.rows[0].unidad,
     categoria ?? antes.rows[0].categoria, precio_venta ?? antes.rows[0].precio_venta,
     activo ?? antes.rows[0].activo, req.usuario!.id]
  );
  // Cambios de precio quedan en bitácora — son sensibles
  await registrarBitacora(pool, req.usuario!.id, 'editar_producto', 'productos', String(req.params.id), {
    antes: antes.rows[0],
    despues: r.rows[0],
  });
  res.json(r.rows[0]);
}));
