import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

/** Catálogos operativos: sucursales, bodegas y vendedores.
 *  Leer: cualquier usuario autenticado (los formularios los necesitan).
 *  Crear/editar: acción de administración (módulo admin). */
export const rutasConfiguracion = Router();

/* ------------------------------------------------------------- sucursales */

rutasConfiguracion.get('/sucursales', envolver(async (_req, res) => {
  const r = await pool.query('SELECT * FROM sucursales ORDER BY codigo');
  res.json(r.rows);
}));

rutasConfiguracion.post('/sucursales', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { codigo, nombre, direccion, telefono, cuenta_caja } = req.body ?? {};
  if (!codigo || !nombre) {
    res.status(400).json({ error: 'codigo y nombre son obligatorios' });
    return;
  }
  const r = await pool.query(
    `INSERT INTO sucursales (codigo, nombre, direccion, telefono, cuenta_caja, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [codigo, nombre, direccion || null, telefono || null, cuenta_caja || null, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'crear_sucursal', 'sucursales', codigo, r.rows[0]);
  res.status(201).json(r.rows[0]);
}));

rutasConfiguracion.put('/sucursales/:codigo', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { nombre, direccion, telefono, activa, cuenta_caja } = req.body ?? {};
  const antes = await pool.query('SELECT * FROM sucursales WHERE codigo = $1', [req.params.codigo]);
  if (antes.rowCount === 0) {
    res.status(404).json({ error: 'Sucursal no existe' });
    return;
  }
  const r = await pool.query(
    `UPDATE sucursales
     SET nombre = $2, direccion = $3, telefono = $4, activa = $5, cuenta_caja = $6,
         actualizado_por = $7, actualizado_en = now()
     WHERE codigo = $1 RETURNING *`,
    [req.params.codigo, nombre ?? antes.rows[0].nombre, direccion ?? antes.rows[0].direccion,
     telefono ?? antes.rows[0].telefono, activa ?? antes.rows[0].activa,
     cuenta_caja !== undefined ? (cuenta_caja || null) : antes.rows[0].cuenta_caja, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'editar_sucursal', 'sucursales', req.params.codigo, {
    antes: antes.rows[0],
    despues: r.rows[0],
  });
  res.json(r.rows[0]);
}));

/* ---------------------------------------------------------------- bodegas */

rutasConfiguracion.get('/bodegas', envolver(async (_req, res) => {
  const r = await pool.query(
    `SELECT b.*, s.nombre AS sucursal_nombre
     FROM bodegas b LEFT JOIN sucursales s ON s.codigo = b.sucursal
     ORDER BY b.codigo`
  );
  res.json(r.rows);
}));

rutasConfiguracion.post('/bodegas', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { codigo, nombre, sucursal } = req.body ?? {};
  if (!codigo || !nombre || !sucursal) {
    res.status(400).json({ error: 'codigo, nombre y sucursal son obligatorios' });
    return;
  }
  const r = await pool.query(
    `INSERT INTO bodegas (codigo, nombre, sucursal, creado_por)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [codigo, nombre, sucursal, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'crear_bodega', 'bodegas', codigo, r.rows[0]);
  res.status(201).json(r.rows[0]);
}));

rutasConfiguracion.put('/bodegas/:codigo', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { nombre, sucursal, activa } = req.body ?? {};
  const antes = await pool.query('SELECT * FROM bodegas WHERE codigo = $1', [req.params.codigo]);
  if (antes.rowCount === 0) {
    res.status(404).json({ error: 'Bodega no existe' });
    return;
  }
  const r = await pool.query(
    `UPDATE bodegas
     SET nombre = $2, sucursal = $3, activa = $4, actualizado_por = $5, actualizado_en = now()
     WHERE codigo = $1 RETURNING *`,
    [req.params.codigo, nombre ?? antes.rows[0].nombre, sucursal ?? antes.rows[0].sucursal,
     activa ?? antes.rows[0].activa, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'editar_bodega', 'bodegas', req.params.codigo, {
    antes: antes.rows[0],
    despues: r.rows[0],
  });
  res.json(r.rows[0]);
}));

/* -------------------------------------------------------------- vendedores */

rutasConfiguracion.get('/vendedores', envolver(async (_req, res) => {
  const r = await pool.query(
    `SELECT v.*, s.nombre AS sucursal_nombre
     FROM vendedores v LEFT JOIN sucursales s ON s.codigo = v.sucursal
     ORDER BY v.nombre`
  );
  res.json(r.rows);
}));

rutasConfiguracion.post('/vendedores', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { codigo, nombre, sucursal } = req.body ?? {};
  if (!nombre) {
    res.status(400).json({ error: 'nombre es obligatorio' });
    return;
  }
  const r = await pool.query(
    `INSERT INTO vendedores (codigo, nombre, sucursal, creado_por)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [codigo || null, nombre, sucursal || null, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'crear_vendedor', 'vendedores', String(r.rows[0].id), r.rows[0]);
  res.status(201).json(r.rows[0]);
}));

rutasConfiguracion.put('/vendedores/:id', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { codigo, nombre, sucursal, activo } = req.body ?? {};
  const antes = await pool.query('SELECT * FROM vendedores WHERE id = $1', [req.params.id]);
  if (antes.rowCount === 0) {
    res.status(404).json({ error: 'Vendedor no existe' });
    return;
  }
  const r = await pool.query(
    `UPDATE vendedores
     SET codigo = $2, nombre = $3, sucursal = $4, activo = $5,
         actualizado_por = $6, actualizado_en = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, codigo ?? antes.rows[0].codigo, nombre ?? antes.rows[0].nombre,
     sucursal ?? antes.rows[0].sucursal, activo ?? antes.rows[0].activo, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'editar_vendedor', 'vendedores', String(req.params.id), {
    antes: antes.rows[0],
    despues: r.rows[0],
  });
  res.json(r.rows[0]);
}));
