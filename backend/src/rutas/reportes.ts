import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';

export const rutasReportes = Router();

interface FilaBalanza {
  codigo: string;
  nombre: string;
  tipo: string;
  nivel: number;
  padre: string | null;
  es_detalle: boolean;
  debitos: number;   // centavos
  creditos: number;  // centavos
}

// Balanza de comprobación en vivo (hasta un período opcional), con las cuentas
// de detalle acumuladas hacia sus cuentas de mayor por la cadena de padres.
rutasReportes.get('/balanza', requierePermiso('contabilidad', 'ver'), envolver(async (req, res) => {
  const hasta = typeof req.query.hasta === 'string' && /^\d{4}-\d{2}$/.test(req.query.hasta)
    ? req.query.hasta
    : null;
  const r = await pool.query(
    `SELECT c.codigo, c.nombre, c.tipo, c.nivel, c.padre, c.es_detalle,
            COALESCE(t.debitos, 0)  AS debitos,
            COALESCE(t.creditos, 0) AS creditos
     FROM cuentas c
     LEFT JOIN (
       SELECT m.cuenta, SUM(m.debito) AS debitos, SUM(m.credito) AS creditos
       FROM movimientos m
       JOIN asientos a ON a.id = m.asiento_id
       WHERE $1::char(7) IS NULL OR a.ano_mes <= $1
       GROUP BY m.cuenta
     ) t ON t.cuenta = c.codigo
     WHERE c.activa
     ORDER BY c.codigo`,
    [hasta]
  );

  const filas: FilaBalanza[] = r.rows.map((f) => ({
    ...f,
    debitos: Math.round(Number(f.debitos) * 100),
    creditos: Math.round(Number(f.creditos) * 100),
  }));
  const porCodigo = new Map(filas.map((f) => [f.codigo, f]));
  let totalDebitos = 0;
  let totalCreditos = 0;
  for (const f of filas) {
    if (!f.es_detalle) continue;
    totalDebitos += f.debitos;
    totalCreditos += f.creditos;
    let padre = f.padre;
    while (padre) {
      const fp = porCodigo.get(padre);
      if (!fp) break;
      fp.debitos += f.debitos;
      fp.creditos += f.creditos;
      padre = fp.padre;
    }
  }

  res.json({
    hasta,
    cuentas: filas.map((f) => ({
      ...f,
      debitos: f.debitos / 100,
      creditos: f.creditos / 100,
      saldo: (f.debitos - f.creditos) / 100,
    })),
    totales: {
      debitos: totalDebitos / 100,
      creditos: totalCreditos / 100,
      cuadrada: totalDebitos === totalCreditos,
    },
  });
}));

// Libro mayor de una cuenta: saldo inicial + movimientos con saldo corrido
rutasReportes.get('/mayor/:cuenta', requierePermiso('contabilidad', 'ver'), envolver(async (req, res) => {
  const cuenta = req.params.cuenta;
  const esFecha = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const desde = esFecha(req.query.desde) ? req.query.desde : null;
  const hasta = esFecha(req.query.hasta) ? req.query.hasta : null;

  const existe = await pool.query('SELECT codigo, nombre FROM cuentas WHERE codigo = $1', [cuenta]);
  if (existe.rowCount === 0) {
    res.status(404).json({ error: `Cuenta ${cuenta} no existe` });
    return;
  }

  const inicial = await pool.query(
    `SELECT COALESCE(SUM(m.debito - m.credito), 0) AS saldo
     FROM movimientos m JOIN asientos a ON a.id = m.asiento_id
     WHERE m.cuenta = $1 AND $2::date IS NOT NULL AND a.fecha < $2`,
    [cuenta, desde]
  );
  const movs = await pool.query(
    `SELECT a.fecha, a.id AS asiento_id, a.tipo_origen, a.concepto, a.anulado,
            m.id, m.debito, m.credito, m.documento_ref, m.tercero_id
     FROM movimientos m JOIN asientos a ON a.id = m.asiento_id
     WHERE m.cuenta = $1
       AND ($2::date IS NULL OR a.fecha >= $2)
       AND ($3::date IS NULL OR a.fecha <= $3)
     ORDER BY a.fecha, a.id, m.id`,
    [cuenta, desde, hasta]
  );

  let saldo = Math.round(Number(inicial.rows[0]?.saldo ?? 0) * 100);
  const saldoInicial = saldo / 100;
  const lineas = movs.rows.map((m) => {
    saldo += Math.round(Number(m.debito) * 100) - Math.round(Number(m.credito) * 100);
    return { ...m, saldo: saldo / 100 };
  });

  res.json({
    cuenta: existe.rows[0],
    desde,
    hasta,
    saldo_inicial: saldoInicial,
    movimientos: lineas,
    saldo_final: saldo / 100,
  });
}));
