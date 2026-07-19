import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool, enTransaccion } from '../db';
import { envolver, aCentavos } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

export const rutasAsientos = Router();

interface LineaAsiento {
  cuenta: string;
  debito?: number;
  credito?: number;
  moneda?: string;
  tipo_cambio?: number;
  monto_origen?: number;
  tercero_id?: number;
  documento_ref?: string;
}

const SQL_ASIENTO_COMPLETO = `
  SELECT a.*,
         COALESCE(
           json_agg(json_build_object(
             'id', m.id, 'cuenta', m.cuenta, 'debito', m.debito, 'credito', m.credito,
             'moneda', m.moneda, 'tipo_cambio', m.tipo_cambio, 'monto_origen', m.monto_origen,
             'tercero_id', m.tercero_id, 'documento_ref', m.documento_ref
           ) ORDER BY m.id) FILTER (WHERE m.id IS NOT NULL), '[]'
         ) AS movimientos
  FROM asientos a
  LEFT JOIN movimientos m ON m.asiento_id = a.id`;

async function verificarPeriodoAbierto(anoMes: string): Promise<string | null> {
  const p = await pool.query('SELECT estado FROM periodos WHERE ano_mes = $1', [anoMes]);
  if (p.rowCount === 0) return `El período ${anoMes} no existe — abrilo primero en Períodos`;
  if (p.rows[0].estado !== 'abierto') return `El período ${anoMes} está cerrado`;
  return null;
}

rutasAsientos.get('/', requierePermiso('contabilidad', 'ver'), envolver(async (req, res) => {
  const anoMes = typeof req.query.ano_mes === 'string' && /^\d{4}-\d{2}$/.test(req.query.ano_mes)
    ? req.query.ano_mes
    : null;
  const r = await pool.query(
    `${SQL_ASIENTO_COMPLETO}
     WHERE $1::char(7) IS NULL OR a.ano_mes = $1
     GROUP BY a.id ORDER BY a.id DESC LIMIT 500`,
    [anoMes]
  );
  res.json(r.rows);
}));

rutasAsientos.get('/:id', requierePermiso('contabilidad', 'ver'), envolver(async (req, res) => {
  const r = await pool.query(`${SQL_ASIENTO_COMPLETO} WHERE a.id = $1 GROUP BY a.id`, [req.params.id]);
  if (r.rowCount === 0) {
    res.status(404).json({ error: 'Asiento no existe' });
    return;
  }
  res.json(r.rows[0]);
}));

// Asiento MANUAL (solo ajustes autorizados — los módulos generan los suyos solos)
rutasAsientos.post('/', requierePermiso('contabilidad', 'crear'), envolver(async (req, res) => {
  const { fecha, concepto, movimientos } = req.body ?? {};
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    res.status(400).json({ error: 'fecha inválida (formato YYYY-MM-DD)' });
    return;
  }
  if (!concepto) {
    res.status(400).json({ error: 'concepto es obligatorio' });
    return;
  }
  if (!Array.isArray(movimientos) || movimientos.length < 2) {
    res.status(400).json({ error: 'Un asiento necesita al menos 2 movimientos' });
    return;
  }
  let debitos = 0;
  let creditos = 0;
  for (const m of movimientos as LineaAsiento[]) {
    const d = aCentavos(m.debito);
    const c = aCentavos(m.credito);
    if (!m.cuenta || Number.isNaN(d) || Number.isNaN(c)) {
      res.status(400).json({ error: 'Movimiento inválido: cuenta y montos >= 0 requeridos' });
      return;
    }
    if ((d === 0) === (c === 0)) {
      res.status(400).json({ error: `Cuenta ${m.cuenta}: cada línea lleva débito O crédito, mayor que cero` });
      return;
    }
    debitos += d;
    creditos += c;
  }
  if (debitos !== creditos) {
    res.status(400).json({
      error: `Asiento descuadrado: débitos ${(debitos / 100).toFixed(2)} ≠ créditos ${(creditos / 100).toFixed(2)}`,
    });
    return;
  }
  const anoMes = fecha.slice(0, 7);
  const errorPeriodo = await verificarPeriodoAbierto(anoMes);
  if (errorPeriodo) {
    res.status(400).json({ error: errorPeriodo });
    return;
  }

  const asiento = await enTransaccion(async (bd: PoolClient) => {
    const a = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, concepto, creado_por)
       VALUES ($1, $2, 'manual', $3, $4) RETURNING *`,
      [fecha, anoMes, concepto, req.usuario!.id]
    );
    const nuevo = a.rows[0];
    for (const m of movimientos as LineaAsiento[]) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, moneda, tipo_cambio, monto_origen, tercero_id, documento_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [nuevo.id, m.cuenta, m.debito ?? 0, m.credito ?? 0, m.moneda ?? 'NIO',
         m.tipo_cambio ?? null, m.monto_origen ?? null, m.tercero_id ?? null, m.documento_ref ?? null]
      );
    }
    await registrarBitacora(bd, req.usuario!.id, 'crear_asiento_manual', 'asientos', String(nuevo.id), {
      concepto,
      lineas: movimientos.length,
    });
    return nuevo;
  });
  res.status(201).json(asiento);
}));

// Anulación por contra-asiento: el original queda intacto y marcado; el contra
// va en el período abierto de HOY (regla: nada se borra, consecutivo completo)
rutasAsientos.post('/:id/anular', requierePermiso('contabilidad', 'anular'), envolver(async (req, res) => {
  const id = Number(req.params.id);
  const { motivo } = req.body ?? {};
  if (!motivo) {
    res.status(400).json({ error: 'Anular exige un motivo (queda en bitácora)' });
    return;
  }
  const hoy = new Date().toISOString().slice(0, 10);
  const anoMesHoy = hoy.slice(0, 7);
  const errorPeriodo = await verificarPeriodoAbierto(anoMesHoy);
  if (errorPeriodo) {
    res.status(400).json({ error: errorPeriodo });
    return;
  }

  interface ResultadoAnulacion {
    error?: number;
    mensaje?: string;
    contra?: unknown;
  }
  const resultado = await enTransaccion<ResultadoAnulacion>(async (bd: PoolClient) => {
    const a = await bd.query('SELECT * FROM asientos WHERE id = $1 FOR UPDATE', [id]);
    if (a.rowCount === 0) return { error: 404, mensaje: 'Asiento no existe' };
    if (a.rows[0].anulado) return { error: 409, mensaje: 'El asiento ya está anulado' };
    if (a.rows[0].tipo_origen === 'contra_asiento') {
      return { error: 409, mensaje: 'Un contra-asiento no se anula' };
    }
    const movs = await bd.query('SELECT * FROM movimientos WHERE asiento_id = $1 ORDER BY id', [id]);

    const contra = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por)
       VALUES ($1, $2, 'contra_asiento', $3, $4, $5) RETURNING *`,
      [hoy, anoMesHoy, id, `Anulación del asiento #${id}: ${motivo}`, req.usuario!.id]
    );
    for (const m of movs.rows) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, moneda, tipo_cambio, monto_origen, tercero_id, documento_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [contra.rows[0].id, m.cuenta, m.credito, m.debito, m.moneda,
         m.tipo_cambio, m.monto_origen, m.tercero_id, m.documento_ref]
      );
    }
    await bd.query('UPDATE asientos SET anulado = true, anulado_por = $2 WHERE id = $1', [id, contra.rows[0].id]);
    await registrarBitacora(bd, req.usuario!.id, 'anular_asiento', 'asientos', String(id), {
      motivo,
      contra_asiento: contra.rows[0].id,
    });
    return { contra: contra.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.status(201).json(resultado.contra);
}));
