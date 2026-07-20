import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool, enTransaccion } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';
import { trasladoInventario, revertirEntrada, revertirSalida } from '../inventario';

/** Traslados entre bodegas: movimiento físico, sin asiento contable.
 *  Aun así respetan el candado de período: alteran el kardex histórico. */
export const rutasTraslados = Router();

async function periodoAbierto(anoMes: string): Promise<string | null> {
  const p = await pool.query('SELECT estado FROM periodos WHERE ano_mes = $1', [anoMes]);
  if (p.rowCount === 0) return `El período ${anoMes} no existe — abrilo primero en Períodos`;
  if (p.rows[0].estado !== 'abierto') return `El período ${anoMes} está cerrado`;
  return null;
}

const SQL_LISTA = `
  SELECT t.*,
         bo.nombre AS origen_nombre,
         bd_.nombre AS destino_nombre,
         (SELECT count(*)::int FROM traslado_lineas WHERE traslado_id = t.id) AS lineas,
         (SELECT COALESCE(SUM(cantidad * costo_unitario), 0) FROM traslado_lineas WHERE traslado_id = t.id) AS valor
  FROM traslados t
  JOIN bodegas bo  ON bo.codigo = t.bodega_origen
  JOIN bodegas bd_ ON bd_.codigo = t.bodega_destino`;

rutasTraslados.get('/', requierePermiso('inventario', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query(`${SQL_LISTA} ORDER BY t.id DESC LIMIT 300`);
  res.json(r.rows);
}));

rutasTraslados.get('/:id', requierePermiso('inventario', 'ver'), envolver(async (req, res) => {
  const r = await pool.query(`${SQL_LISTA} WHERE t.id = $1`, [req.params.id]);
  if (r.rowCount === 0) {
    res.status(404).json({ error: 'Traslado no existe' });
    return;
  }
  const lineas = await pool.query(
    `SELECT tl.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre, p.unidad
     FROM traslado_lineas tl JOIN productos p ON p.id = tl.producto_id
     WHERE tl.traslado_id = $1 ORDER BY tl.id`,
    [req.params.id]
  );
  res.json({ ...r.rows[0], lineas: lineas.rows });
}));

// Realizar traslado (directo — la mercadería se mueve al confirmar)
rutasTraslados.post('/', requierePermiso('inventario', 'crear'), envolver(async (req, res) => {
  const { fecha, bodega_origen, bodega_destino, notas, lineas } = req.body ?? {};
  if (!bodega_origen || !bodega_destino || bodega_origen === bodega_destino) {
    res.status(400).json({ error: 'Bodega origen y destino son obligatorias y distintas' });
    return;
  }
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    res.status(400).json({ error: 'fecha inválida (YYYY-MM-DD)' });
    return;
  }
  if (!Array.isArray(lineas) || lineas.length === 0) {
    res.status(400).json({ error: 'El traslado necesita al menos una línea' });
    return;
  }
  for (const l of lineas as Array<{ producto_id: number; cantidad: number }>) {
    if (!l.producto_id || !Number.isFinite(Number(l.cantidad)) || Number(l.cantidad) <= 0) {
      res.status(400).json({ error: 'Cada línea necesita producto y cantidad > 0' });
      return;
    }
  }
  const bodegas = await pool.query(
    `SELECT codigo FROM bodegas WHERE codigo IN ($1, $2) AND activa`,
    [bodega_origen, bodega_destino]
  );
  if (bodegas.rowCount !== 2) {
    res.status(400).json({ error: 'Alguna de las bodegas no existe o está inactiva' });
    return;
  }
  const errorPeriodo = await periodoAbierto(fecha.slice(0, 7));
  if (errorPeriodo) {
    res.status(400).json({ error: errorPeriodo });
    return;
  }

  const traslado = await enTransaccion(async (bd: PoolClient) => {
    const t = await bd.query(
      `INSERT INTO traslados (fecha, bodega_origen, bodega_destino, notas, creado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [fecha, bodega_origen, bodega_destino, notas || null, req.usuario!.id]
    );
    for (const l of lineas as Array<{ producto_id: number; cantidad: number }>) {
      const costo = await trasladoInventario(
        bd,
        { fecha, productoId: l.producto_id, bodega: bodega_origen, cantidad: Number(l.cantidad),
          usuarioId: req.usuario!.id, origenTipo: 'traslado', origenId: t.rows[0].id },
        bodega_destino
      );
      await bd.query(
        `INSERT INTO traslado_lineas (traslado_id, producto_id, cantidad, costo_unitario)
         VALUES ($1, $2, $3, $4)`,
        [t.rows[0].id, l.producto_id, Number(l.cantidad), costo]
      );
    }
    await registrarBitacora(bd, req.usuario!.id, 'realizar_traslado', 'traslados', String(t.rows[0].id), {
      de: bodega_origen,
      a: bodega_destino,
      lineas: lineas.length,
    });
    return t.rows[0];
  });
  res.status(201).json(traslado);
}));

// Anular: la mercadería regresa (exige que el destino todavía la tenga)
rutasTraslados.post('/:id/anular', requierePermiso('inventario', 'anular'), envolver(async (req, res) => {
  const id = Number(req.params.id);
  const { motivo } = req.body ?? {};
  if (!motivo) {
    res.status(400).json({ error: 'Anular exige un motivo (queda en bitácora)' });
    return;
  }
  const hoy = new Date().toISOString().slice(0, 10);

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; traslado?: unknown }> => {
    const t = await bd.query('SELECT * FROM traslados WHERE id = $1 FOR UPDATE', [id]);
    if (t.rowCount === 0) return { error: 404, mensaje: 'Traslado no existe' };
    const traslado = t.rows[0];
    if (traslado.estado !== 'realizado') return { error: 409, mensaje: 'El traslado ya está anulado' };

    const lineas = await bd.query('SELECT * FROM traslado_lineas WHERE traslado_id = $1', [id]);
    for (const l of lineas.rows) {
      const enDestino = await bd.query(
        'SELECT COALESCE(cantidad, 0) AS cantidad FROM existencias WHERE producto_id = $1 AND bodega = $2',
        [l.producto_id, traslado.bodega_destino]
      );
      if (Number(enDestino.rows[0]?.cantidad ?? 0) < Number(l.cantidad)) {
        return {
          error: 409,
          mensaje: `No se puede anular: la bodega ${traslado.bodega_destino} ya no tiene la cantidad trasladada (¿se vendió?)`,
        };
      }
    }
    for (const l of lineas.rows) {
      // regreso: sale del destino y reingresa al origen, al costo del traslado
      await revertirEntrada(
        bd,
        { fecha: hoy, productoId: l.producto_id, bodega: traslado.bodega_destino, cantidad: Number(l.cantidad),
          usuarioId: req.usuario!.id, origenTipo: 'traslado', origenId: id },
        Number(l.costo_unitario)
      );
      await revertirSalida(
        bd,
        { fecha: hoy, productoId: l.producto_id, bodega: traslado.bodega_origen, cantidad: Number(l.cantidad),
          usuarioId: req.usuario!.id, origenTipo: 'traslado', origenId: id },
        Number(l.costo_unitario)
      );
    }
    const anulado = await bd.query(
      `UPDATE traslados SET estado = 'anulado', actualizado_por = $2, actualizado_en = now()
       WHERE id = $1 RETURNING *`,
      [id, req.usuario!.id]
    );
    await registrarBitacora(bd, req.usuario!.id, 'anular_traslado', 'traslados', String(id), { motivo });
    return { traslado: anulado.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.json(resultado.traslado);
}));
