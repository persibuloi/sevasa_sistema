import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool, enTransaccion } from '../db';
import { envolver, aCentavos } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';
import { leerConfig } from '../config';
import { entradaInventario, revertirEntrada } from '../inventario';

export const rutasCompras = Router();

interface LineaCompraEntrada {
  producto_id: number;
  cantidad: number;
  costo_unitario: number;
}

function calcularTotales(lineas: unknown, tasaIva: number) {
  if (!Array.isArray(lineas) || lineas.length === 0) return null;
  const limpias: Array<LineaCompraEntrada & { total: number }> = [];
  let subtotalCent = 0;
  for (const l of lineas as LineaCompraEntrada[]) {
    const cantidad = Number(l.cantidad);
    const costo = Number(l.costo_unitario);
    if (!l.producto_id || !Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(costo) || costo < 0) {
      return null;
    }
    const totalCent = Math.round(cantidad * aCentavos(costo));
    subtotalCent += totalCent;
    limpias.push({ producto_id: l.producto_id, cantidad, costo_unitario: costo, total: totalCent / 100 });
  }
  const ivaCent = Math.round(subtotalCent * tasaIva);
  return { lineas: limpias, subtotal: subtotalCent / 100, iva: ivaCent / 100, total: (subtotalCent + ivaCent) / 100 };
}

async function periodoAbierto(anoMes: string): Promise<string | null> {
  const p = await pool.query('SELECT estado FROM periodos WHERE ano_mes = $1', [anoMes]);
  if (p.rowCount === 0) return `El período ${anoMes} no existe — abrilo primero en Períodos`;
  if (p.rows[0].estado !== 'abierto') return `El período ${anoMes} está cerrado`;
  return null;
}

const SQL_LISTA = `
  SELECT c.*, t.nombre AS proveedor, b.nombre AS bodega_nombre
  FROM compras c
  JOIN terceros t ON t.id = c.tercero_id
  JOIN bodegas b  ON b.codigo = c.bodega`;

rutasCompras.get('/', requierePermiso('compras', 'ver'), envolver(async (req, res) => {
  const estado = typeof req.query.estado === 'string' && ['borrador', 'registrada', 'anulada'].includes(req.query.estado)
    ? req.query.estado
    : null;
  const r = await pool.query(
    `${SQL_LISTA} WHERE $1::text IS NULL OR c.estado = $1 ORDER BY c.id DESC LIMIT 300`,
    [estado]
  );
  res.json(r.rows);
}));

rutasCompras.get('/:id', requierePermiso('compras', 'ver'), envolver(async (req, res) => {
  const r = await pool.query(`${SQL_LISTA} WHERE c.id = $1`, [req.params.id]);
  if (r.rowCount === 0) {
    res.status(404).json({ error: 'Compra no existe' });
    return;
  }
  const lineas = await pool.query(
    `SELECT cl.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre
     FROM compra_lineas cl JOIN productos p ON p.id = cl.producto_id
     WHERE cl.compra_id = $1 ORDER BY cl.id`,
    [req.params.id]
  );
  res.json({ ...r.rows[0], lineas: lineas.rows });
}));

rutasCompras.post('/', requierePermiso('compras', 'crear'), envolver(async (req, res) => {
  const { orden_compra_id, tercero_id, numero_documento, fecha, tipo_pago, bodega, lineas, notas } = req.body ?? {};
  if (!tercero_id || !numero_documento || !bodega || !['contado', 'credito'].includes(tipo_pago)) {
    res.status(400).json({ error: 'tercero_id, numero_documento, bodega y tipo_pago son obligatorios' });
    return;
  }
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    res.status(400).json({ error: 'fecha inválida (YYYY-MM-DD)' });
    return;
  }
  const cfg = await leerConfig(pool, ['tasa_iva']);
  const totales = calcularTotales(lineas, Number(cfg.tasa_iva));
  if (!totales) {
    res.status(400).json({ error: 'Líneas inválidas: producto, cantidad > 0 y costo >= 0' });
    return;
  }
  const codigos = Array.isArray(req.body?.retenciones_codigos)
    ? (req.body.retenciones_codigos as unknown[]).map(String)
    : [];
  const cuentaPago = typeof req.body?.cuenta_pago === 'string' && req.body.cuenta_pago !== ''
    ? req.body.cuenta_pago
    : null;
  const compra = await enTransaccion(async (bd: PoolClient) => {
    const c = await bd.query(
      `INSERT INTO compras (orden_compra_id, tercero_id, numero_documento, fecha, tipo_pago, bodega,
                            subtotal, iva, total, notas, retenciones_codigos, cuenta_pago, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [orden_compra_id || null, tercero_id, numero_documento, fecha, tipo_pago, bodega,
       totales.subtotal, totales.iva, totales.total, notas || null, codigos, cuentaPago, req.usuario!.id]
    );
    for (const l of totales.lineas) {
      await bd.query(
        `INSERT INTO compra_lineas (compra_id, producto_id, cantidad, costo_unitario, total)
         VALUES ($1, $2, $3, $4, $5)`,
        [c.rows[0].id, l.producto_id, l.cantidad, l.costo_unitario, l.total]
      );
    }
    return c.rows[0];
  });
  res.status(201).json(compra);
}));

rutasCompras.put('/:id', requierePermiso('compras', 'editar'), envolver(async (req, res) => {
  const { tercero_id, numero_documento, fecha, tipo_pago, bodega, lineas, notas } = req.body ?? {};
  const actual = await pool.query('SELECT estado FROM compras WHERE id = $1', [req.params.id]);
  if (actual.rowCount === 0) {
    res.status(404).json({ error: 'Compra no existe' });
    return;
  }
  if (actual.rows[0].estado !== 'borrador') {
    res.status(409).json({ error: 'Solo los borradores se editan; una registrada se anula' });
    return;
  }
  const cfg = await leerConfig(pool, ['tasa_iva']);
  const totales = calcularTotales(lineas, Number(cfg.tasa_iva));
  if (!totales) {
    res.status(400).json({ error: 'Líneas inválidas: producto, cantidad > 0 y costo >= 0' });
    return;
  }
  const codigos = Array.isArray(req.body?.retenciones_codigos)
    ? (req.body.retenciones_codigos as unknown[]).map(String)
    : [];
  const cuentaPago = typeof req.body?.cuenta_pago === 'string' && req.body.cuenta_pago !== ''
    ? req.body.cuenta_pago
    : null;
  const compra = await enTransaccion(async (bd: PoolClient) => {
    const c = await bd.query(
      `UPDATE compras
       SET tercero_id = $2, numero_documento = $3, fecha = $4, tipo_pago = $5, bodega = $6,
           subtotal = $7, iva = $8, total = $9, notas = $10, retenciones_codigos = $11,
           cuenta_pago = $12, actualizado_por = $13, actualizado_en = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, tercero_id, numero_documento, fecha, tipo_pago, bodega,
       totales.subtotal, totales.iva, totales.total, notas || null, codigos, cuentaPago, req.usuario!.id]
    );
    await bd.query('DELETE FROM compra_lineas WHERE compra_id = $1', [req.params.id]);
    for (const l of totales.lineas) {
      await bd.query(
        `INSERT INTO compra_lineas (compra_id, producto_id, cantidad, costo_unitario, total)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, l.producto_id, l.cantidad, l.costo_unitario, l.total]
      );
    }
    return c.rows[0];
  });
  res.json(compra);
}));

rutasCompras.delete('/:id', requierePermiso('compras', 'editar'), envolver(async (req, res) => {
  const r = await pool.query(`DELETE FROM compras WHERE id = $1 AND estado = 'borrador' RETURNING id`, [req.params.id]);
  if (r.rowCount === 0) {
    res.status(409).json({ error: 'Solo los borradores se pueden descartar' });
    return;
  }
  res.json({ ok: true });
}));

// REGISTRAR: asiento (Inventario + IVA acreditable vs CxP/Caja) + kardex +
// costo promedio, todo en UNA transacción
rutasCompras.post('/:id/registrar', requierePermiso('compras', 'crear'), envolver(async (req, res) => {
  const id = Number(req.params.id);
  const previa = await pool.query('SELECT fecha FROM compras WHERE id = $1', [id]);
  if (previa.rowCount === 0) {
    res.status(404).json({ error: 'Compra no existe' });
    return;
  }
  const fecha: string = previa.rows[0].fecha.toISOString().slice(0, 10);
  const errorPeriodo = await periodoAbierto(fecha.slice(0, 7));
  if (errorPeriodo) {
    res.status(400).json({ error: errorPeriodo });
    return;
  }

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; compra?: unknown }> => {
    const c = await bd.query('SELECT * FROM compras WHERE id = $1 FOR UPDATE', [id]);
    const compra = c.rows[0];
    if (compra.estado !== 'borrador') return { error: 409, mensaje: 'La compra ya fue registrada o anulada' };

    const lineas = await bd.query('SELECT * FROM compra_lineas WHERE compra_id = $1 ORDER BY id', [id]);
    if (lineas.rowCount === 0) return { error: 400, mensaje: 'La compra no tiene líneas' };

    const proveedor = await bd.query('SELECT nombre FROM terceros WHERE id = $1', [compra.tercero_id]);
    const cfg = await leerConfig(bd, ['cuenta_inventario', 'cuenta_iva_acreditable', 'cuenta_cxp', 'cuenta_caja']);

    // Retenciones efectuadas: cada tipo acredita su cuenta y baja el neto a pagar
    const codigos: string[] = compra.retenciones_codigos ?? [];
    const retenciones: Array<{ codigo: string; cuenta: string; base: number; monto: number }> = [];
    let retencionCent = 0;
    for (const codigo of codigos) {
      const rt = await bd.query(
        `SELECT tasa, base, cuenta_contable FROM retencion_tipos WHERE codigo = $1 AND activo AND aplica = 'compra'`,
        [codigo]
      );
      if (rt.rowCount === 0) return { error: 400, mensaje: `Retención "${codigo}" no existe, está inactiva o no aplica a compras` };
      const baseMonto = rt.rows[0].base === 'iva' ? Number(compra.iva)
        : rt.rows[0].base === 'total' ? Number(compra.total)
        : Number(compra.subtotal);
      const montoCent = Math.round(baseMonto * Number(rt.rows[0].tasa) * 100);
      retencionCent += montoCent;
      retenciones.push({ codigo, cuenta: rt.rows[0].cuenta_contable, base: baseMonto, monto: montoCent / 100 });
    }
    const netoAPagar = Math.round(Number(compra.total) * 100) - retencionCent;
    if (netoAPagar < 0) return { error: 400, mensaje: 'Las retenciones superan el total de la compra' };

    const asiento = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por)
       VALUES ($1, $2, 'compra', $3, $4, $5) RETURNING id`,
      [fecha, fecha.slice(0, 7), id,
       `Compra ${compra.numero_documento} — ${proveedor.rows[0]?.nombre ?? ''} (${compra.tipo_pago})`,
       req.usuario!.id]
    );
    const asientoId = asiento.rows[0].id;
    await bd.query(
      `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref)
       VALUES ($1, $2, $3, 0, $4)`,
      [asientoId, cfg.cuenta_inventario, compra.subtotal, compra.numero_documento]
    );
    if (Number(compra.iva) > 0) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref)
         VALUES ($1, $2, $3, 0, $4)`,
        [asientoId, cfg.cuenta_iva_acreditable, compra.iva, compra.numero_documento]
      );
    }
    // Cada retención: crédito a su cuenta (pasivo con la DGI)
    for (const r of retenciones) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref)
         VALUES ($1, $2, 0, $3, $4)`,
        [asientoId, r.cuenta, r.monto, compra.numero_documento]
      );
      await bd.query(
        `INSERT INTO compra_retenciones (compra_id, tipo_codigo, base, monto) VALUES ($1, $2, $3, $4)`,
        [id, r.codigo, r.base, r.monto]
      );
    }
    // CxP/Caja recibe el NETO (total − retenciones). En contado, la caja
    // elegida en el documento (o la general si no se indicó)
    const cuentaAbono = compra.tipo_pago === 'credito'
      ? cfg.cuenta_cxp
      : (compra.cuenta_pago ?? cfg.cuenta_caja);
    await bd.query(
      `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, tercero_id, documento_ref)
       VALUES ($1, $2, 0, $3, $4, $5)`,
      [asientoId, cuentaAbono, netoAPagar / 100,
       compra.tipo_pago === 'credito' ? compra.tercero_id : null, compra.numero_documento]
    );

    for (const l of lineas.rows) {
      await entradaInventario(
        bd,
        { fecha, productoId: l.producto_id, bodega: compra.bodega, cantidad: Number(l.cantidad),
          usuarioId: req.usuario!.id, origenTipo: 'compra', origenId: id },
        Number(l.costo_unitario)
      );
    }

    const registrada = await bd.query(
      `UPDATE compras SET estado = 'registrada', asiento_id = $2, registrada_en = now(),
              actualizado_por = $3, actualizado_en = now()
       WHERE id = $1 RETURNING *`,
      [id, asientoId, req.usuario!.id]
    );
    if (compra.orden_compra_id) {
      await bd.query(`UPDATE ordenes_compra SET estado = 'recibida' WHERE id = $1 AND estado = 'aprobada'`, [
        compra.orden_compra_id,
      ]);
    }
    await registrarBitacora(bd, req.usuario!.id, 'registrar_compra', 'compras', String(id), {
      numero_documento: compra.numero_documento,
      total: compra.total,
    });
    return { compra: registrada.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.json(resultado.compra);
}));

rutasCompras.post('/:id/anular', requierePermiso('compras', 'anular'), envolver(async (req, res) => {
  const id = Number(req.params.id);
  const { motivo } = req.body ?? {};
  if (!motivo) {
    res.status(400).json({ error: 'Anular exige un motivo (queda en bitácora)' });
    return;
  }
  const hoy = new Date().toISOString().slice(0, 10);
  const errorPeriodo = await periodoAbierto(hoy.slice(0, 7));
  if (errorPeriodo) {
    res.status(400).json({ error: errorPeriodo });
    return;
  }

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; compra?: unknown }> => {
    const c = await bd.query('SELECT * FROM compras WHERE id = $1 FOR UPDATE', [id]);
    if (c.rowCount === 0) return { error: 404, mensaje: 'Compra no existe' };
    const compra = c.rows[0];
    if (compra.estado !== 'registrada') return { error: 409, mensaje: 'Solo se anulan compras registradas' };

    const movs = await bd.query('SELECT * FROM movimientos WHERE asiento_id = $1 ORDER BY id', [compra.asiento_id]);
    const contra = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por)
       VALUES ($1, $2, 'contra_asiento', $3, $4, $5) RETURNING id`,
      [hoy, hoy.slice(0, 7), id, `Anulación compra ${compra.numero_documento}: ${motivo}`, req.usuario!.id]
    );
    for (const m of movs.rows) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, tercero_id, documento_ref)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [contra.rows[0].id, m.cuenta, m.credito, m.debito, m.tercero_id, m.documento_ref]
      );
    }
    await bd.query('UPDATE asientos SET anulado = true, anulado_por = $2 WHERE id = $1', [
      compra.asiento_id,
      contra.rows[0].id,
    ]);

    const lineas = await bd.query('SELECT * FROM compra_lineas WHERE compra_id = $1', [id]);
    for (const l of lineas.rows) {
      await revertirEntrada(
        bd,
        { fecha: hoy, productoId: l.producto_id, bodega: compra.bodega, cantidad: Number(l.cantidad),
          usuarioId: req.usuario!.id, origenTipo: 'compra', origenId: id },
        Number(l.costo_unitario)
      );
    }

    const anulada = await bd.query(
      `UPDATE compras SET estado = 'anulada', actualizado_por = $2, actualizado_en = now()
       WHERE id = $1 RETURNING *`,
      [id, req.usuario!.id]
    );
    await registrarBitacora(bd, req.usuario!.id, 'anular_compra', 'compras', String(id), {
      numero_documento: compra.numero_documento,
      motivo,
      contra_asiento: contra.rows[0].id,
    });
    return { compra: anulada.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.json(resultado.compra);
}));
