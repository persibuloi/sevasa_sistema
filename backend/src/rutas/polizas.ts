import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool, enTransaccion } from '../db';
import { envolver, aCentavos } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';
import { leerConfig } from '../config';
import { entradaInventario, revertirEntrada } from '../inventario';
import { prorratear, type LineaCalc, type GastoCalc } from '../polizas-calculo';

/** F5 — Pólizas de importación: prorrateo del costo puesto en bodega. */
export const rutasPolizas = Router();

async function periodoAbierto(anoMes: string): Promise<string | null> {
  const p = await pool.query('SELECT estado FROM periodos WHERE ano_mes = $1', [anoMes]);
  if (p.rowCount === 0) return `El período ${anoMes} no existe — abrilo primero en Períodos`;
  if (p.rows[0].estado !== 'abierto') return `El período ${anoMes} está cerrado`;
  return null;
}

interface LineaEntrada { producto_id: number; cantidad: number; fob_unitario: number; peso?: number; tercero_id?: number | null }
interface GastoEntrada { concepto: string; monto: number; base?: string; es_iva?: boolean; cuenta_contable: string }

function limpiar(lineas: unknown, gastos: unknown):
  | { lineas: Required<LineaEntrada>[]; gastos: Required<GastoEntrada>[] }
  | null {
  if (!Array.isArray(lineas) || lineas.length === 0) return null;
  const ls: Required<LineaEntrada>[] = [];
  for (const l of lineas as LineaEntrada[]) {
    const cantidad = Number(l.cantidad);
    const fob = Number(l.fob_unitario);
    if (!l.producto_id || !Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(fob) || fob < 0) return null;
    ls.push({ producto_id: l.producto_id, cantidad, fob_unitario: fob, peso: Number(l.peso ?? 0) || 0, tercero_id: l.tercero_id ? Number(l.tercero_id) : null });
  }
  const gs: Required<GastoEntrada>[] = [];
  for (const g of (Array.isArray(gastos) ? gastos : []) as GastoEntrada[]) {
    const monto = Number(g.monto);
    if (!g.concepto || !g.cuenta_contable || !Number.isFinite(monto) || monto < 0) return null;
    gs.push({
      concepto: g.concepto,
      monto,
      base: ['valor', 'peso', 'unidades'].includes(g.base ?? '') ? (g.base as string) : 'valor',
      es_iva: Boolean(g.es_iva),
      cuenta_contable: g.cuenta_contable,
    });
  }
  return { lineas: ls, gastos: gs };
}

const SQL_LISTA = `
  SELECT p.*, t.nombre AS proveedor, b.nombre AS bodega_nombre,
         (SELECT count(*)::int FROM poliza_lineas WHERE poliza_id = p.id) AS productos
  FROM polizas p
  LEFT JOIN terceros t ON t.id = p.tercero_id
  JOIN bodegas b ON b.codigo = p.bodega`;

rutasPolizas.get('/', requierePermiso('polizas', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query(`${SQL_LISTA} ORDER BY p.id DESC LIMIT 300`);
  res.json(r.rows);
}));

rutasPolizas.get('/:id', requierePermiso('polizas', 'ver'), envolver(async (req, res) => {
  const r = await pool.query(`${SQL_LISTA} WHERE p.id = $1`, [req.params.id]);
  if (r.rowCount === 0) {
    res.status(404).json({ error: 'Póliza no existe' });
    return;
  }
  const lineas = await pool.query(
    `SELECT pl.*, pr.codigo AS producto_codigo, pr.nombre AS producto_nombre, pr.unidad,
            t.nombre AS proveedor
     FROM poliza_lineas pl JOIN productos pr ON pr.id = pl.producto_id
     LEFT JOIN terceros t ON t.id = pl.tercero_id
     WHERE pl.poliza_id = $1 ORDER BY pl.id`,
    [req.params.id]
  );
  const gastos = await pool.query(
    `SELECT pg.*, c.nombre AS cuenta_nombre FROM poliza_gastos pg
     LEFT JOIN cuentas c ON c.codigo = pg.cuenta_contable
     WHERE pg.poliza_id = $1 ORDER BY pg.id`,
    [req.params.id]
  );
  res.json({ ...r.rows[0], lineas: lineas.rows, gastos: gastos.rows });
}));

// Preview del prorrateo (sin persistir) — el editor lo llama para mostrar el
// costo puesto en bodega en vivo; misma lógica que la liquidación
rutasPolizas.post('/calcular', requierePermiso('polizas', 'ver'), envolver(async (req, res) => {
  const limpio = limpiar(req.body?.lineas, req.body?.gastos);
  if (!limpio) {
    res.status(400).json({ error: 'Líneas inválidas (producto, cantidad > 0, FOB >= 0)' });
    return;
  }
  const tc = Number(req.body?.tipo_cambio ?? 1) || 1;
  const calc = prorratear(
    limpio.lineas.map<LineaCalc>((l) => ({ cantidad: l.cantidad, fobUnitario: l.fob_unitario, peso: l.peso })),
    limpio.gastos.map<GastoCalc>((g) => ({ montoCent: aCentavos(g.monto), base: g.base as GastoCalc['base'], esIva: g.es_iva })),
    tc
  );
  res.json({
    fob: calc.fobCent / 100,
    gastos: calc.gastosCent / 100,
    iva: calc.ivaCent / 100,
    total_inventario: calc.totalInventarioCent / 100,
    lineas: calc.porLinea.map((l, i) => ({
      producto_id: limpio.lineas[i]!.producto_id,
      costo_unitario: l.totalCent / limpio.lineas[i]!.cantidad / 100,
      total: l.totalCent / 100,
    })),
  });
}));

async function guardarBorrador(bd: PoolClient, id: number | null, req: import('express').Request): Promise<number> {
  const { numero, tercero_id, fecha, bodega, moneda, tipo_cambio, notas } = req.body ?? {};
  const limpio = limpiar(req.body?.lineas, req.body?.gastos)!;
  const ordenesIds = Array.isArray(req.body?.ordenes_ids)
    ? (req.body.ordenes_ids as unknown[]).map(Number).filter((n) => Number.isInteger(n))
    : [];
  const usuario = req.usuario!.id;
  let polizaId = id;
  if (polizaId === null) {
    const p = await bd.query(
      `INSERT INTO polizas (numero, tercero_id, fecha, bodega, moneda, tipo_cambio, notas, ordenes_ids, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [numero, tercero_id || null, fecha, bodega, moneda === 'NIO' ? 'NIO' : 'USD',
       Number(tipo_cambio) || 1, notas || null, ordenesIds, usuario]
    );
    polizaId = p.rows[0].id as number;
  } else {
    await bd.query(
      `UPDATE polizas SET numero=$2, tercero_id=$3, fecha=$4, bodega=$5, moneda=$6, tipo_cambio=$7,
              notas=$8, ordenes_ids=$9, actualizado_por=$10, actualizado_en=now() WHERE id=$1`,
      [polizaId, numero, tercero_id || null, fecha, bodega, moneda === 'NIO' ? 'NIO' : 'USD',
       Number(tipo_cambio) || 1, notas || null, ordenesIds, usuario]
    );
    await bd.query('DELETE FROM poliza_lineas WHERE poliza_id = $1', [polizaId]);
    await bd.query('DELETE FROM poliza_gastos WHERE poliza_id = $1', [polizaId]);
  }
  for (const l of limpio.lineas) {
    await bd.query(
      `INSERT INTO poliza_lineas (poliza_id, producto_id, cantidad, fob_unitario, peso, tercero_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [polizaId, l.producto_id, l.cantidad, l.fob_unitario, l.peso, l.tercero_id]
    );
  }
  for (const g of limpio.gastos) {
    await bd.query(
      `INSERT INTO poliza_gastos (poliza_id, concepto, monto, base, es_iva, cuenta_contable) VALUES ($1,$2,$3,$4,$5,$6)`,
      [polizaId, g.concepto, g.monto, g.base, g.es_iva, g.cuenta_contable]
    );
  }
  return polizaId;
}

rutasPolizas.post('/', requierePermiso('polizas', 'crear'), envolver(async (req, res) => {
  const { numero, fecha, bodega } = req.body ?? {};
  if (!numero || !bodega || typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    res.status(400).json({ error: 'numero, bodega y fecha (YYYY-MM-DD) son obligatorios' });
    return;
  }
  if (!limpiar(req.body?.lineas, req.body?.gastos)) {
    res.status(400).json({ error: 'Líneas inválidas (producto, cantidad > 0, FOB >= 0) o gasto sin cuenta' });
    return;
  }
  const id = await enTransaccion((bd) => guardarBorrador(bd, null, req));
  res.status(201).json({ id });
}));

rutasPolizas.put('/:id', requierePermiso('polizas', 'crear'), envolver(async (req, res) => {
  const actual = await pool.query('SELECT estado FROM polizas WHERE id = $1', [req.params.id]);
  if (actual.rowCount === 0) {
    res.status(404).json({ error: 'Póliza no existe' });
    return;
  }
  if (actual.rows[0].estado !== 'borrador') {
    res.status(409).json({ error: 'Solo los borradores se editan; una liquidada se anula' });
    return;
  }
  if (!limpiar(req.body?.lineas, req.body?.gastos)) {
    res.status(400).json({ error: 'Líneas inválidas o gasto sin cuenta' });
    return;
  }
  await enTransaccion((bd) => guardarBorrador(bd, Number(req.params.id), req));
  res.json({ id: Number(req.params.id) });
}));

rutasPolizas.delete('/:id', requierePermiso('polizas', 'crear'), envolver(async (req, res) => {
  const r = await pool.query(`DELETE FROM polizas WHERE id = $1 AND estado = 'borrador' RETURNING id`, [req.params.id]);
  if (r.rowCount === 0) {
    res.status(409).json({ error: 'Solo los borradores se descartan' });
    return;
  }
  res.json({ ok: true });
}));

// LIQUIDAR: prorratea, mete cada producto al inventario a su costo puesto en
// bodega (kardex + promedio) y genera el asiento de nacionalización
rutasPolizas.post('/:id/liquidar', requierePermiso('polizas', 'crear'), envolver(async (req, res) => {
  const id = Number(req.params.id);
  const previa = await pool.query('SELECT fecha, estado FROM polizas WHERE id = $1', [id]);
  if (previa.rowCount === 0) {
    res.status(404).json({ error: 'Póliza no existe' });
    return;
  }
  const fecha: string = previa.rows[0].fecha.toISOString().slice(0, 10);
  const errorPeriodo = await periodoAbierto(fecha.slice(0, 7));
  if (errorPeriodo) {
    res.status(400).json({ error: errorPeriodo });
    return;
  }

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; poliza?: unknown }> => {
    const p = await bd.query('SELECT * FROM polizas WHERE id = $1 FOR UPDATE', [id]);
    const poliza = p.rows[0];
    if (poliza.estado !== 'borrador') return { error: 409, mensaje: 'La póliza ya fue liquidada o anulada' };

    const lineas = await bd.query('SELECT * FROM poliza_lineas WHERE poliza_id = $1 ORDER BY id', [id]);
    if (lineas.rowCount === 0) return { error: 400, mensaje: 'La póliza no tiene productos' };
    const gastos = await bd.query('SELECT * FROM poliza_gastos WHERE poliza_id = $1 ORDER BY id', [id]);

    const tc = Number(poliza.tipo_cambio) || 1;
    const calc = prorratear(
      lineas.rows.map<LineaCalc>((l) => ({ cantidad: Number(l.cantidad), fobUnitario: Number(l.fob_unitario), peso: Number(l.peso) })),
      gastos.rows.map<GastoCalc>((g) => ({ montoCent: aCentavos(Number(g.monto)), base: g.base, esIva: g.es_iva })),
      tc
    );

    const cfg = await leerConfig(bd, ['cuenta_inventario', 'cuenta_iva_acreditable', 'cuenta_cxp']);
    const proveedor = poliza.tercero_id
      ? (await bd.query('SELECT nombre FROM terceros WHERE id = $1', [poliza.tercero_id])).rows[0]?.nombre
      : 'importación';

    const asiento = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por)
       VALUES ($1, $2, 'poliza', $3, $4, $5) RETURNING id`,
      [fecha, fecha.slice(0, 7), id, `Póliza ${poliza.numero} — nacionalización (${proveedor})`, req.usuario!.id]
    );
    const asientoId = asiento.rows[0].id;

    // D Inventario (FOB + gastos no-IVA)
    await bd.query(
      `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1,$2,$3,0,$4)`,
      [asientoId, cfg.cuenta_inventario, calc.totalInventarioCent / 100, poliza.numero]
    );
    // D IVA acreditable
    if (calc.ivaCent > 0) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1,$2,$3,0,$4)`,
        [asientoId, cfg.cuenta_iva_acreditable, calc.ivaCent / 100, poliza.numero]
      );
    }
    // C CxP: el FOB se acredita a la CxP de CADA proveedor por su parte
    // (multipóliza). La línea sin proveedor cae en el proveedor del encabezado.
    const fobPorProveedor = new Map<number | null, number>();
    for (let i = 0; i < lineas.rows.length; i++) {
      const prov = lineas.rows[i].tercero_id ?? poliza.tercero_id ?? null;
      fobPorProveedor.set(prov, (fobPorProveedor.get(prov) ?? 0) + calc.porLinea[i]!.fobCent);
    }
    for (const [prov, fobCent] of fobPorProveedor) {
      if (fobCent <= 0) continue;
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, tercero_id, documento_ref) VALUES ($1,$2,0,$3,$4,$5)`,
        [asientoId, cfg.cuenta_cxp, fobCent / 100, prov, poliza.numero]
      );
    }
    // C cada gasto → su cuenta contrapartida
    for (const g of gastos.rows) {
      if (Number(g.monto) <= 0) continue;
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1,$2,0,$3,$4)`,
        [asientoId, g.cuenta_contable, Number(g.monto), poliza.numero]
      );
    }

    // Entrada a inventario de cada producto a su costo puesto en bodega
    for (let i = 0; i < lineas.rows.length; i++) {
      const l = lineas.rows[i];
      const costoTotalCent = calc.porLinea[i]!.totalCent;
      const costoUnitario = costoTotalCent / Number(l.cantidad) / 100;
      await entradaInventario(
        bd,
        { fecha, productoId: l.producto_id, bodega: poliza.bodega, cantidad: Number(l.cantidad),
          usuarioId: req.usuario!.id, origenTipo: 'poliza', origenId: id },
        costoUnitario
      );
      await bd.query(
        `UPDATE poliza_lineas SET costo_unitario = $2, total = $3 WHERE id = $1`,
        [l.id, costoUnitario.toFixed(4), (costoTotalCent / 100).toFixed(2)]
      );
    }

    const liquidada = await bd.query(
      `UPDATE polizas SET estado='liquidada', asiento_id=$2, liquidada_en=now(),
              fob=$3, gastos=$4, iva=$5, total_inventario=$6, actualizado_por=$7, actualizado_en=now()
       WHERE id=$1 RETURNING *`,
      [id, asientoId, calc.fobCent / 100, calc.gastosCent / 100, calc.ivaCent / 100,
       calc.totalInventarioCent / 100, req.usuario!.id]
    );
    // Las órdenes de compra de las que se armó la póliza quedan recibidas
    if (Array.isArray(poliza.ordenes_ids) && poliza.ordenes_ids.length > 0) {
      await bd.query(
        `UPDATE ordenes_compra SET estado = 'recibida', actualizado_en = now()
         WHERE id = ANY($1) AND estado IN ('aprobada', 'borrador')`,
        [poliza.ordenes_ids]
      );
    }
    await registrarBitacora(bd, req.usuario!.id, 'liquidar_poliza', 'polizas', String(id), {
      numero: poliza.numero,
      total_inventario: calc.totalInventarioCent / 100,
      ordenes: poliza.ordenes_ids,
    });
    return { poliza: liquidada.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.json(resultado.poliza);
}));

rutasPolizas.post('/:id/anular', requierePermiso('polizas', 'anular'), envolver(async (req, res) => {
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

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; poliza?: unknown }> => {
    const p = await bd.query('SELECT * FROM polizas WHERE id = $1 FOR UPDATE', [id]);
    if (p.rowCount === 0) return { error: 404, mensaje: 'Póliza no existe' };
    const poliza = p.rows[0];
    if (poliza.estado !== 'liquidada') return { error: 409, mensaje: 'Solo se anulan pólizas liquidadas' };

    const movs = await bd.query('SELECT * FROM movimientos WHERE asiento_id = $1 ORDER BY id', [poliza.asiento_id]);
    const contra = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por)
       VALUES ($1,$2,'contra_asiento',$3,$4,$5) RETURNING id`,
      [hoy, hoy.slice(0, 7), id, `Anulación póliza ${poliza.numero}: ${motivo}`, req.usuario!.id]
    );
    for (const m of movs.rows) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, tercero_id, documento_ref) VALUES ($1,$2,$3,$4,$5,$6)`,
        [contra.rows[0].id, m.cuenta, m.credito, m.debito, m.tercero_id, m.documento_ref]
      );
    }
    await bd.query('UPDATE asientos SET anulado = true, anulado_por = $2 WHERE id = $1', [poliza.asiento_id, contra.rows[0].id]);

    const lineas = await bd.query('SELECT * FROM poliza_lineas WHERE poliza_id = $1', [id]);
    for (const l of lineas.rows) {
      await revertirEntrada(
        bd,
        { fecha: hoy, productoId: l.producto_id, bodega: poliza.bodega, cantidad: Number(l.cantidad),
          usuarioId: req.usuario!.id, origenTipo: 'poliza', origenId: id },
        Number(l.costo_unitario)
      );
    }

    const anulada = await bd.query(
      `UPDATE polizas SET estado='anulada', actualizado_por=$2, actualizado_en=now() WHERE id=$1 RETURNING *`,
      [id, req.usuario!.id]
    );
    await registrarBitacora(bd, req.usuario!.id, 'anular_poliza', 'polizas', String(id), { numero: poliza.numero, motivo });
    return { poliza: anulada.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.json(resultado.poliza);
}));
