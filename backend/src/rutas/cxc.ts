import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool, enTransaccion } from '../db';
import { envolver, aCentavos } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';
import { leerConfig } from '../config';
import { entradaInventario, revertirEntrada } from '../inventario';

/** CxC: cartera (antigüedad), recibos de cobro y notas de crédito. */
export const rutasCxc = Router();

async function periodoAbierto(anoMes: string): Promise<string | null> {
  const p = await pool.query('SELECT estado FROM periodos WHERE ano_mes = $1', [anoMes]);
  if (p.rowCount === 0) return `El período ${anoMes} no existe — abrilo primero en Períodos`;
  if (p.rows[0].estado !== 'abierto') return `El período ${anoMes} está cerrado`;
  return null;
}

/** Consecutivo con row-lock (mismo patrón que facturas). Exige que la serie
 *  sea del tipo de documento correcto — una serie de facturas jamás numera recibos. */
async function tomarNumero(
  bd: PoolClient,
  serieCodigo: string,
  documento: 'recibo' | 'nota_credito'
): Promise<{ numero: number; numeroCompleto: string }> {
  const r = await bd.query(
    `UPDATE series SET ultimo_numero = ultimo_numero + 1
     WHERE serie = $1 AND activa AND documento = $2 RETURNING ultimo_numero, prefijo`,
    [serieCodigo, documento]
  );
  if (r.rowCount === 0) {
    throw new Error(`La serie ${serieCodigo} no existe, está inactiva o no es una serie de ${documento}`);
  }
  const numero: number = r.rows[0].ultimo_numero;
  return { numero, numeroCompleto: `${r.rows[0].prefijo}${String(numero).padStart(6, '0')}` };
}

const SQL_SALDOS = `
  SELECT f.id, f.numero_completo, f.fecha, f.total, f.tercero_id,
         t.nombre AS cliente, t.terminos_dias,
         COALESCE(cob.monto, 0) AS cobrado,
         COALESCE(ncr.monto, 0) AS acreditado,
         (f.total - COALESCE(cob.monto, 0) - COALESCE(ncr.monto, 0)) AS saldo
  FROM facturas f
  JOIN terceros t ON t.id = f.tercero_id
  LEFT JOIN (
    SELECT ra.factura_id, SUM(ra.monto) AS monto
    FROM recibo_aplicaciones ra JOIN recibos r ON r.id = ra.recibo_id AND r.estado = 'emitido'
    GROUP BY ra.factura_id
  ) cob ON cob.factura_id = f.id
  LEFT JOIN (
    SELECT factura_id, SUM(total) AS monto FROM notas_credito WHERE estado = 'emitida' GROUP BY factura_id
  ) ncr ON ncr.factura_id = f.id
  WHERE f.estado = 'emitida' AND f.tipo_pago = 'credito'`;

/* ----------------------------------------------------------------- cartera */

rutasCxc.get('/cartera', requierePermiso('cxc', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query(`${SQL_SALDOS} ORDER BY t.nombre, f.fecha`);
  const hoy = new Date();
  const filas = r.rows
    .map((f) => {
      const saldo = Math.round(Number(f.saldo) * 100) / 100;
      const vence = new Date(f.fecha);
      vence.setDate(vence.getDate() + Number(f.terminos_dias));
      const diasVencida = Math.floor((hoy.getTime() - vence.getTime()) / 86400000);
      const bucket =
        diasVencida <= 0 ? 'corriente'
        : diasVencida <= 30 ? 'd1_30'
        : diasVencida <= 60 ? 'd31_60'
        : diasVencida <= 90 ? 'd61_90'
        : 'd90_mas';
      return { ...f, saldo, vence: vence.toISOString().slice(0, 10), dias_vencida: Math.max(diasVencida, 0), bucket };
    })
    .filter((f) => f.saldo > 0.009);

  const resumen = { corriente: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_mas: 0, total: 0 };
  for (const f of filas) {
    resumen[f.bucket as keyof typeof resumen] += f.saldo;
    resumen.total += f.saldo;
  }
  for (const k of Object.keys(resumen) as Array<keyof typeof resumen>) {
    resumen[k] = Math.round(resumen[k] * 100) / 100;
  }
  res.json({ facturas: filas, resumen });
}));

// Facturas con saldo pendiente de UN cliente (para armar el recibo)
rutasCxc.get('/cartera/:terceroId', requierePermiso('cxc', 'ver'), envolver(async (req, res) => {
  const r = await pool.query(`${SQL_SALDOS} AND f.tercero_id = $1 ORDER BY f.fecha`, [req.params.terceroId]);
  res.json(r.rows.filter((f) => Number(f.saldo) > 0.009));
}));

/* ----------------------------------------------------------------- recibos */

rutasCxc.get('/recibos', requierePermiso('cxc', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query(
    `SELECT r.*, t.nombre AS cliente FROM recibos r
     JOIN terceros t ON t.id = r.tercero_id ORDER BY r.id DESC LIMIT 300`
  );
  res.json(r.rows);
}));

rutasCxc.get('/recibos/:id', requierePermiso('cxc', 'ver'), envolver(async (req, res) => {
  const r = await pool.query(
    `SELECT r.*, t.nombre AS cliente FROM recibos r JOIN terceros t ON t.id = r.tercero_id WHERE r.id = $1`,
    [req.params.id]
  );
  if (r.rowCount === 0) {
    res.status(404).json({ error: 'Recibo no existe' });
    return;
  }
  const apl = await pool.query(
    `SELECT ra.*, f.numero_completo AS factura FROM recibo_aplicaciones ra
     LEFT JOIN facturas f ON f.id = ra.factura_id WHERE ra.recibo_id = $1 ORDER BY ra.id`,
    [req.params.id]
  );
  res.json({ ...r.rows[0], aplicaciones: apl.rows });
}));

const FORMAS_PAGO = ['efectivo', 'transferencia', 'cheque', 'tarjeta'];

rutasCxc.post('/recibos', requierePermiso('cxc', 'crear'), envolver(async (req, res) => {
  const { fecha, tercero_id, forma_pago, referencia, notas, aplicaciones } = req.body ?? {};
  if (!tercero_id || !FORMAS_PAGO.includes(forma_pago)) {
    res.status(400).json({ error: 'tercero_id y forma_pago válida son obligatorios' });
    return;
  }
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    res.status(400).json({ error: 'fecha inválida (YYYY-MM-DD)' });
    return;
  }
  if (!Array.isArray(aplicaciones) || aplicaciones.length === 0) {
    res.status(400).json({ error: 'El recibo necesita al menos una aplicación (factura o a cuenta)' });
    return;
  }
  // Agregar por factura ANTES de validar: una factura repetida en la petición
  // se suma — así el total aplicado jamás supera el saldo (auditoría P0)
  const porFactura = new Map<number, number>();
  let aCuentaCent = 0;
  let totalCent = 0;
  for (const a of aplicaciones as Array<{ factura_id?: number | null; monto: number }>) {
    const c = aCentavos(a.monto);
    if (Number.isNaN(c) || c <= 0) {
      res.status(400).json({ error: 'Cada aplicación necesita un monto mayor que cero' });
      return;
    }
    totalCent += c;
    if (a.factura_id) porFactura.set(Number(a.factura_id), (porFactura.get(Number(a.factura_id)) ?? 0) + c);
    else aCuentaCent += c;
  }
  const errorPeriodo = await periodoAbierto(fecha.slice(0, 7));
  if (errorPeriodo) {
    res.status(400).json({ error: errorPeriodo });
    return;
  }

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; recibo?: unknown }> => {
    // Validar el TOTAL aplicado a cada factura (ya agregado): del cliente,
    // emitida, crédito, con saldo suficiente — con lock de la factura
    for (const [facturaId, montoCentFactura] of porFactura) {
      const f = await bd.query(`${SQL_SALDOS} AND f.id = $1 FOR UPDATE OF f`, [facturaId]);
      if (f.rowCount === 0) return { error: 400, mensaje: `La factura ${facturaId} no es de crédito emitida` };
      if (Number(f.rows[0].tercero_id) !== Number(tercero_id)) {
        return { error: 400, mensaje: `La factura ${f.rows[0].numero_completo} no es de este cliente` };
      }
      if (montoCentFactura > Math.round(Number(f.rows[0].saldo) * 100) + 1) {
        return {
          error: 400,
          mensaje: `La factura ${f.rows[0].numero_completo} solo debe ${Number(f.rows[0].saldo).toFixed(2)}`,
        };
      }
    }

    const cfg = await leerConfig(bd, ['serie_recibos', 'cuenta_caja', 'cuenta_cxc']);
    const { numero, numeroCompleto } = await tomarNumero(bd, cfg.serie_recibos!, 'recibo');
    const total = totalCent / 100;
    const cliente = await bd.query('SELECT nombre FROM terceros WHERE id = $1', [tercero_id]);

    const asiento = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, concepto, creado_por)
       VALUES ($1, $2, 'recibo', $3, $4) RETURNING id`,
      [fecha, fecha.slice(0, 7), `Recibo ${numeroCompleto} — ${cliente.rows[0]?.nombre ?? ''} (${forma_pago})`, req.usuario!.id]
    );
    // Retenciones sufridas (recibidas): debitan su cuenta (anticipo IR) y el
    // efectivo entra por el NETO. Hoy SEVASA es exento, pero queda disponible.
    const retEntrada = Array.isArray(req.body?.retenciones) ? req.body.retenciones : [];
    const retenciones: Array<{ codigo: string; cuenta: string; base: number; monto: number }> = [];
    let retencionCent = 0;
    for (const r of retEntrada as Array<{ tipo_codigo: string; base: number }>) {
      const rt = await bd.query(
        `SELECT tasa, cuenta_contable FROM retencion_tipos WHERE codigo = $1 AND activo AND aplica = 'venta'`,
        [r.tipo_codigo]
      );
      if (rt.rowCount === 0) return { error: 400, mensaje: `Retención "${r.tipo_codigo}" no existe o no aplica a ventas` };
      const baseMonto = Number(r.base);
      if (!Number.isFinite(baseMonto) || baseMonto <= 0) return { error: 400, mensaje: 'Base de retención inválida' };
      const montoCent = Math.round(baseMonto * Number(rt.rows[0].tasa) * 100);
      retencionCent += montoCent;
      retenciones.push({ codigo: r.tipo_codigo, cuenta: rt.rows[0].cuenta_contable, base: baseMonto, monto: montoCent / 100 });
    }
    const efectivoCent = Math.round(total * 100) - retencionCent;
    if (efectivoCent < 0) return { error: 400, mensaje: 'Las retenciones superan el total del recibo' };

    await bd.query(
      `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1, $2, $3, 0, $4)`,
      [asiento.rows[0].id, cfg.cuenta_caja, efectivoCent / 100, numeroCompleto]
    );
    for (const r of retenciones) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1, $2, $3, 0, $4)`,
        [asiento.rows[0].id, r.cuenta, r.monto, numeroCompleto]
      );
    }
    await bd.query(
      `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, tercero_id, documento_ref)
       VALUES ($1, $2, 0, $3, $4, $5)`,
      [asiento.rows[0].id, cfg.cuenta_cxc, total, tercero_id, numeroCompleto]
    );

    const recibo = await bd.query(
      `INSERT INTO recibos (serie, numero, numero_completo, fecha, tercero_id, forma_pago, referencia, total,
                            asiento_id, notas, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [cfg.serie_recibos, numero, numeroCompleto, fecha, tercero_id, forma_pago, referencia || null, total,
       asiento.rows[0].id, notas || null, req.usuario!.id]
    );
    for (const [facturaId, montoCentFactura] of porFactura) {
      await bd.query(
        `INSERT INTO recibo_aplicaciones (recibo_id, factura_id, monto) VALUES ($1, $2, $3)`,
        [recibo.rows[0].id, facturaId, montoCentFactura / 100]
      );
    }
    if (aCuentaCent > 0) {
      await bd.query(
        `INSERT INTO recibo_aplicaciones (recibo_id, factura_id, monto) VALUES ($1, NULL, $2)`,
        [recibo.rows[0].id, aCuentaCent / 100]
      );
    }
    for (const r of retenciones) {
      await bd.query(
        `INSERT INTO recibo_retenciones (recibo_id, tipo_codigo, base, monto) VALUES ($1, $2, $3, $4)`,
        [recibo.rows[0].id, r.codigo, r.base, r.monto]
      );
    }
    await registrarBitacora(bd, req.usuario!.id, 'emitir_recibo', 'recibos', String(recibo.rows[0].id), {
      numero: numeroCompleto,
      total,
      forma_pago,
    });
    return { recibo: recibo.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.status(201).json(resultado.recibo);
}));

rutasCxc.post('/recibos/:id/anular', requierePermiso('cxc', 'anular'), envolver(async (req, res) => {
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

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; recibo?: unknown }> => {
    const r = await bd.query('SELECT * FROM recibos WHERE id = $1 FOR UPDATE', [id]);
    if (r.rowCount === 0) return { error: 404, mensaje: 'Recibo no existe' };
    if (r.rows[0].estado !== 'emitido') return { error: 409, mensaje: 'El recibo ya está anulado' };

    const movs = await bd.query('SELECT * FROM movimientos WHERE asiento_id = $1 ORDER BY id', [r.rows[0].asiento_id]);
    const contra = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por)
       VALUES ($1, $2, 'contra_asiento', $3, $4, $5) RETURNING id`,
      [hoy, hoy.slice(0, 7), id, `Anulación recibo ${r.rows[0].numero_completo}: ${motivo}`, req.usuario!.id]
    );
    for (const m of movs.rows) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, tercero_id, documento_ref)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [contra.rows[0].id, m.cuenta, m.credito, m.debito, m.tercero_id, m.documento_ref]
      );
    }
    await bd.query('UPDATE asientos SET anulado = true, anulado_por = $2 WHERE id = $1', [
      r.rows[0].asiento_id,
      contra.rows[0].id,
    ]);
    const anulado = await bd.query(
      `UPDATE recibos SET estado = 'anulado', actualizado_por = $2, actualizado_en = now()
       WHERE id = $1 RETURNING *`,
      [id, req.usuario!.id]
    );
    await registrarBitacora(bd, req.usuario!.id, 'anular_recibo', 'recibos', String(id), {
      numero: r.rows[0].numero_completo,
      motivo,
    });
    return { recibo: anulado.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.json(resultado.recibo);
}));

/* ---------------------------------------------------------- notas de crédito */

rutasCxc.get('/notas', requierePermiso('cxc', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query(
    `SELECT n.*, t.nombre AS cliente, f.numero_completo AS factura
     FROM notas_credito n
     JOIN terceros t ON t.id = n.tercero_id
     JOIN facturas f ON f.id = n.factura_id
     ORDER BY n.id DESC LIMIT 300`
  );
  res.json(r.rows);
}));

rutasCxc.post('/notas', requierePermiso('cxc', 'crear'), envolver(async (req, res) => {
  const { factura_id, tipo, motivo, fecha, lineas, monto } = req.body ?? {};
  if (!factura_id || !['devolucion', 'rebaja'].includes(tipo) || !motivo) {
    res.status(400).json({ error: 'factura_id, tipo (devolucion/rebaja) y motivo son obligatorios' });
    return;
  }
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    res.status(400).json({ error: 'fecha inválida (YYYY-MM-DD)' });
    return;
  }
  const errorPeriodo = await periodoAbierto(fecha.slice(0, 7));
  if (errorPeriodo) {
    res.status(400).json({ error: errorPeriodo });
    return;
  }

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; nota?: unknown }> => {
    const f = await bd.query('SELECT * FROM facturas WHERE id = $1 FOR UPDATE', [factura_id]);
    if (f.rowCount === 0) return { error: 404, mensaje: 'Factura no existe' };
    const factura = f.rows[0];
    if (factura.estado !== 'emitida') return { error: 409, mensaje: 'Solo se acredita sobre facturas emitidas' };

    const cfg = await leerConfig(bd, [
      'tasa_iva', 'serie_notas_credito',
      'cuenta_ventas', 'cuenta_iva', 'cuenta_cxc', 'cuenta_caja',
      'cuenta_inventario', 'cuenta_costo_ventas',
    ]);
    const tasa = Number(cfg.tasa_iva);

    let subtotalCent = 0;
    let costoCent = 0;
    const lineasNota: Array<{ factura_linea_id: number; producto_id: number | null; cantidad: number; precio: number; total: number }> = [];

    if (tipo === 'devolucion') {
      if (!Array.isArray(lineas) || lineas.length === 0) {
        return { error: 400, mensaje: 'La devolución necesita líneas (qué se devuelve)' };
      }
      // Agregar por línea de factura ANTES de validar: repetir la misma línea
      // en la petición se SUMA — no puede devolver más de lo facturado (P0)
      const porLinea = new Map<number, number>();
      for (const l of lineas as Array<{ factura_linea_id: number; cantidad: number }>) {
        const cantidad = Number(l.cantidad);
        if (!l.factura_linea_id || !Number.isFinite(cantidad) || cantidad <= 0) {
          return { error: 400, mensaje: 'Cada línea de devolución necesita factura_linea_id y cantidad > 0' };
        }
        porLinea.set(Number(l.factura_linea_id), (porLinea.get(Number(l.factura_linea_id)) ?? 0) + cantidad);
      }
      for (const [lineaId, cantidad] of porLinea) {
        const fl = await bd.query('SELECT * FROM factura_lineas WHERE id = $1 AND factura_id = $2', [
          lineaId, factura_id,
        ]);
        if (fl.rowCount === 0) return { error: 400, mensaje: `La línea ${lineaId} no es de esta factura` };
        const original = fl.rows[0];
        const yaDevuelto = await bd.query(
          `SELECT COALESCE(SUM(ncl.cantidad), 0) AS c
           FROM nota_credito_lineas ncl JOIN notas_credito n ON n.id = ncl.nota_id AND n.estado = 'emitida'
           WHERE ncl.factura_linea_id = $1`,
          [lineaId]
        );
        const disponible = Number(original.cantidad) - Number(yaDevuelto.rows[0].c);
        if (cantidad > disponible + 0.001) {
          return { error: 400, mensaje: `De "${original.descripcion}" solo quedan ${disponible} por devolver` };
        }
        const totalLineaCent = Math.round(cantidad * aCentavos(Number(original.precio_unitario)));
        subtotalCent += totalLineaCent;
        lineasNota.push({
          factura_linea_id: lineaId,
          producto_id: original.producto_id,
          cantidad,
          precio: Number(original.precio_unitario),
          total: totalLineaCent / 100,
        });
      }
    } else {
      const m = aCentavos(monto);
      if (Number.isNaN(m) || m <= 0) return { error: 400, mensaje: 'La rebaja necesita un monto (sin IVA) mayor que cero' };
      subtotalCent = m;
    }

    const ivaCent = Math.round(subtotalCent * tasa);
    const totalCent = subtotalCent + ivaCent;

    // La NC no puede exceder el saldo pendiente (facturas de crédito)
    if (factura.tipo_pago === 'credito') {
      const s = await bd.query(`${SQL_SALDOS} AND f.id = $1`, [factura_id]);
      const saldo = Math.round(Number(s.rows[0]?.saldo ?? 0) * 100);
      if (totalCent > saldo + 1) {
        return { error: 400, mensaje: `La nota (${(totalCent / 100).toFixed(2)}) excede el saldo de la factura (${(saldo / 100).toFixed(2)})` };
      }
    }

    const { numero, numeroCompleto } = await tomarNumero(bd, cfg.serie_notas_credito!, 'nota_credito');

    // Id de la nota reservado ANTES de tocar inventario: el kardex nace con su
    // origen correcto (sin adopciones de huérfanos — auditoría P1)
    const idNota = await bd.query(`SELECT nextval(pg_get_serial_sequence('notas_credito', 'id')) AS id`);
    const notaId = Number(idNota.rows[0].id);

    const asiento = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por)
       VALUES ($1, $2, 'nota_credito', $3, $4, $5) RETURNING id`,
      [fecha, fecha.slice(0, 7), factura_id,
       `Nota de crédito ${numeroCompleto} s/factura ${factura.numero_completo} (${tipo}): ${motivo}`,
       req.usuario!.id]
    );
    const asientoId = asiento.rows[0].id;
    await bd.query(
      `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1, $2, $3, 0, $4)`,
      [asientoId, cfg.cuenta_ventas, subtotalCent / 100, numeroCompleto]
    );
    if (ivaCent > 0) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1, $2, $3, 0, $4)`,
        [asientoId, cfg.cuenta_iva, ivaCent / 100, numeroCompleto]
      );
    }
    const cuentaAbono = factura.tipo_pago === 'credito' ? cfg.cuenta_cxc : cfg.cuenta_caja;
    await bd.query(
      `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, tercero_id, documento_ref)
       VALUES ($1, $2, 0, $3, $4, $5)`,
      [asientoId, cuentaAbono, totalCent / 100,
       factura.tipo_pago === 'credito' ? factura.tercero_id : null, numeroCompleto]
    );

    // Devolución: reingreso al inventario al costo con que salió esa factura
    if (tipo === 'devolucion') {
      for (const l of lineasNota) {
        if (!l.producto_id) continue;
        const salida = await bd.query(
          `SELECT bodega, costo_unitario FROM movimientos_inventario
           WHERE origen_tipo = 'factura' AND origen_id = $1 AND producto_id = $2 AND tipo = 'salida_venta'
           ORDER BY id LIMIT 1`,
          [factura_id, l.producto_id]
        );
        if (salida.rowCount === 0) continue;  // línea sin kardex (venta previa al inventario)
        const costo = Number(salida.rows[0].costo_unitario);
        await entradaInventario(
          bd,
          { fecha, productoId: l.producto_id, bodega: salida.rows[0].bodega, cantidad: l.cantidad,
            usuarioId: req.usuario!.id, origenTipo: 'nota_credito', origenId: notaId },
          costo
        );
        costoCent += Math.round(l.cantidad * costo * 100);
      }
      if (costoCent > 0) {
        await bd.query(
          `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1, $2, $3, 0, $4)`,
          [asientoId, cfg.cuenta_inventario, costoCent / 100, numeroCompleto]
        );
        await bd.query(
          `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1, $2, 0, $3, $4)`,
          [asientoId, cfg.cuenta_costo_ventas, costoCent / 100, numeroCompleto]
        );
      }
    }

    const nota = await bd.query(
      `INSERT INTO notas_credito (id, serie, numero, numero_completo, fecha, factura_id, tercero_id, tipo, motivo,
                                  subtotal, iva, total, costo, asiento_id, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [notaId, cfg.serie_notas_credito, numero, numeroCompleto, fecha, factura_id, factura.tercero_id, tipo, motivo,
       subtotalCent / 100, ivaCent / 100, totalCent / 100, costoCent / 100, asientoId, req.usuario!.id]
    );
    for (const l of lineasNota) {
      await bd.query(
        `INSERT INTO nota_credito_lineas (nota_id, factura_linea_id, producto_id, cantidad, precio_unitario, total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [notaId, l.factura_linea_id, l.producto_id, l.cantidad, l.precio, l.total]
      );
    }
    await registrarBitacora(bd, req.usuario!.id, 'emitir_nota_credito', 'notas_credito', String(nota.rows[0].id), {
      numero: numeroCompleto,
      factura: factura.numero_completo,
      tipo,
      total: totalCent / 100,
    });
    return { nota: nota.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.status(201).json(resultado.nota);
}));

rutasCxc.post('/notas/:id/anular', requierePermiso('cxc', 'anular'), envolver(async (req, res) => {
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

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; nota?: unknown }> => {
    const n = await bd.query('SELECT * FROM notas_credito WHERE id = $1 FOR UPDATE', [id]);
    if (n.rowCount === 0) return { error: 404, mensaje: 'Nota de crédito no existe' };
    if (n.rows[0].estado !== 'emitida') return { error: 409, mensaje: 'La nota ya está anulada' };

    const movs = await bd.query('SELECT * FROM movimientos WHERE asiento_id = $1 ORDER BY id', [n.rows[0].asiento_id]);
    const contra = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por)
       VALUES ($1, $2, 'contra_asiento', $3, $4, $5) RETURNING id`,
      [hoy, hoy.slice(0, 7), id, `Anulación NC ${n.rows[0].numero_completo}: ${motivo}`, req.usuario!.id]
    );
    for (const m of movs.rows) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, tercero_id, documento_ref)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [contra.rows[0].id, m.cuenta, m.credito, m.debito, m.tercero_id, m.documento_ref]
      );
    }
    await bd.query('UPDATE asientos SET anulado = true, anulado_por = $2 WHERE id = $1', [
      n.rows[0].asiento_id,
      contra.rows[0].id,
    ]);

    // Devolución anulada → la mercadería vuelve a salir
    const entradas = await bd.query(
      `SELECT * FROM movimientos_inventario
       WHERE origen_tipo = 'nota_credito' AND origen_id = $1 AND tipo = 'devolucion'`,
      [id]
    );
    for (const k of entradas.rows) {
      await revertirEntrada(
        bd,
        { fecha: hoy, productoId: k.producto_id, bodega: k.bodega, cantidad: Math.abs(Number(k.cantidad)),
          usuarioId: req.usuario!.id, origenTipo: 'nota_credito', origenId: id },
        Number(k.costo_unitario)
      );
    }

    const anulada = await bd.query(
      `UPDATE notas_credito SET estado = 'anulada', actualizado_por = $2, actualizado_en = now()
       WHERE id = $1 RETURNING *`,
      [id, req.usuario!.id]
    );
    await registrarBitacora(bd, req.usuario!.id, 'anular_nota_credito', 'notas_credito', String(id), {
      numero: n.rows[0].numero_completo,
      motivo,
    });
    return { nota: anulada.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.json(resultado.nota);
}));
