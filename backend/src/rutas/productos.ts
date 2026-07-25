import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso, tienePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

export const rutasProductos = Router();

/** El COSTO es dato de inventario, no de ventas: quien solo factura ve
 *  precios y existencias, nunca cuánto nos cuesta la mercadería. */
function sinCosto<T extends { costo_promedio?: unknown }>(filas: T[]): T[] {
  return filas.map(({ costo_promedio, ...resto }) => {
    void costo_promedio;
    return resto as T;
  });
}

rutasProductos.get('/', requierePermiso('facturacion', 'ver'), envolver(async (req, res) => {
  // ?bodega=BOD-CEN agrega la existencia de ESA bodega (para el filtro por tienda)
  const bodega = typeof req.query.bodega === 'string' && req.query.bodega !== '' ? req.query.bodega : null;
  const veCostos = await tienePermiso(req.usuario!, 'inventario', 'ver');

  // Con ?pagina= responde paginado del servidor: {productos, total} — el
  // catálogo real trae miles de filas y cargarlo entero pone lento todo.
  if (req.query.pagina !== undefined) {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const porPagina = Math.min(200, Math.max(1, Number(req.query.por_pagina) || 50));
    const parametros: unknown[] = [porPagina, (pagina - 1) * porPagina];
    let filtro = '';
    if (q) {
      parametros.push(`%${q}%`);
      filtro = `WHERE p.codigo ILIKE $3 OR p.nombre ILIKE $3 OR p.categoria ILIKE $3`;
    }
    const r = await pool.query(
      `SELECT p.*, COALESCE(e.existencia, 0) AS existencia, count(*) OVER() AS total
       FROM productos p
       LEFT JOIN (
         SELECT producto_id, SUM(cantidad) AS existencia FROM existencias GROUP BY producto_id
       ) e ON e.producto_id = p.id
       ${filtro}
       ORDER BY p.codigo LIMIT $1 OFFSET $2`,
      parametros
    );
    const filas = r.rows.map(({ total, ...p }) => p);
    res.json({
      productos: veCostos ? filas : sinCosto(filas),
      total: Number(r.rows[0]?.total ?? 0),
    });
    return;
  }

  const r = await pool.query(
    `SELECT p.*,
            COALESCE(e.existencia, 0) AS existencia,
            COALESCE(eb.cantidad, 0)  AS existencia_bodega
     FROM productos p
     LEFT JOIN (
       SELECT producto_id, SUM(cantidad) AS existencia FROM existencias GROUP BY producto_id
     ) e ON e.producto_id = p.id
     LEFT JOIN existencias eb ON eb.producto_id = p.id AND eb.bodega = $1
     ORDER BY p.codigo`,
    [bodega]
  );
  res.json(veCostos ? r.rows : sinCosto(r.rows));
}));

// Existencias de UN producto, bodega por bodega (para el detalle en pantalla)
rutasProductos.get('/:id/existencias', requierePermiso('facturacion', 'ver'), envolver(async (req, res) => {
  const r = await pool.query(
    `SELECT e.bodega, b.nombre AS bodega_nombre, b.sucursal, e.cantidad
     FROM existencias e JOIN bodegas b ON b.codigo = e.bodega
     WHERE e.producto_id = $1 AND e.cantidad <> 0
     ORDER BY e.bodega`,
    [req.params.id]
  );
  res.json(r.rows);
}));

// Kardex de un producto (últimos 200 movimientos) — trae costos: es de inventario
rutasProductos.get('/:id/kardex', requierePermiso('inventario', 'ver'), envolver(async (req, res) => {
  const r = await pool.query(
    `SELECT m.*, b.nombre AS bodega_nombre
     FROM movimientos_inventario m LEFT JOIN bodegas b ON b.codigo = m.bodega
     WHERE m.producto_id = $1 ORDER BY m.id DESC LIMIT 200`,
    [req.params.id]
  );
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
