import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool, enTransaccion } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';
import { leerConfig } from '../config';

/** F6 — Estados financieros: Balance General, Estado de Resultados y cierre.
 *  Todo en centavos enteros; jerarquía acumulada hacia cuentas de mayor. */
export const rutasEstados = Router();

interface FilaCuenta {
  codigo: string;
  nombre: string;
  tipo: string;
  nivel: number;
  padre: string | null;
  es_detalle: boolean;
  saldoCent: number;   // con el signo natural de su tipo
}

const esMes = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);

/** Resta n meses a un YYYY-MM. */
function mesMenos(anoMes: string, n: number): string {
  const [a, m] = anoMes.split('-').map(Number);
  const total = a! * 12 + (m! - 1) - n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Meses inclusivos entre dos YYYY-MM. */
function largoRango(desde: string, hasta: string): number {
  const [a1, m1] = desde.split('-').map(Number);
  const [a2, m2] = hasta.split('-').map(Number);
  return a2! * 12 + m2! - (a1! * 12 + m1!) + 1;
}

/** Saldos por cuenta (detalle, en centavos, signo natural) para un filtro de período. */
async function saldos(tipos: string[], desde: string | null, hasta: string | null): Promise<FilaCuenta[]> {
  const r = await pool.query(
    `SELECT c.codigo, c.nombre, c.tipo, c.nivel, c.padre, c.es_detalle,
            COALESCE(t.debitos, 0) AS debitos, COALESCE(t.creditos, 0) AS creditos
     FROM cuentas c
     LEFT JOIN (
       SELECT m.cuenta, SUM(m.debito) AS debitos, SUM(m.credito) AS creditos
       FROM movimientos m JOIN asientos a ON a.id = m.asiento_id
       WHERE ($1::char(7) IS NULL OR a.ano_mes >= $1)
         AND ($2::char(7) IS NULL OR a.ano_mes <= $2)
       GROUP BY m.cuenta
     ) t ON t.cuenta = c.codigo
     WHERE c.activa AND c.tipo = ANY($3)
     ORDER BY c.codigo`,
    [desde, hasta, tipos]
  );
  const filas: FilaCuenta[] = r.rows.map((f) => {
    const d = Math.round(Number(f.debitos) * 100);
    const c = Math.round(Number(f.creditos) * 100);
    // Signo natural: activo/costo/gasto = deudor; pasivo/capital/ingreso = acreedor
    const deudor = f.tipo === 'activo' || f.tipo === 'costo' || f.tipo === 'gasto';
    return { ...f, saldoCent: deudor ? d - c : c - d };
  });
  // Acumular detalle hacia las cuentas de mayor
  const porCodigo = new Map(filas.map((f) => [f.codigo, f]));
  for (const f of filas) {
    if (!f.es_detalle) continue;
    let padre = f.padre;
    while (padre) {
      const fp = porCodigo.get(padre);
      if (!fp) break;
      fp.saldoCent += f.saldoCent;
      padre = fp.padre;
    }
  }
  return filas;
}

function totalDe(filas: FilaCuenta[], tipo: string): number {
  return filas.filter((f) => f.tipo === tipo && f.es_detalle).reduce((s, f) => s + f.saldoCent, 0);
}

function presentar(filas: FilaCuenta[], conCeros = false) {
  return filas
    .filter((f) => conCeros || f.saldoCent !== 0)
    .map((f) => ({
      codigo: f.codigo, nombre: f.nombre, tipo: f.tipo, nivel: f.nivel,
      es_detalle: f.es_detalle, saldo: f.saldoCent / 100,
    }));
}

/* ----------------------------------------------------------- balance general */

rutasEstados.get('/balance', requierePermiso('contabilidad', 'ver'), envolver(async (req, res) => {
  const hasta = esMes(req.query.hasta) ? req.query.hasta : null;

  const patrimonio = await saldos(['activo', 'pasivo', 'capital'], null, hasta);
  const resultados = await saldos(['ingreso', 'costo', 'gasto'], null, hasta);

  const activoCent = totalDe(patrimonio, 'activo');
  const pasivoCent = totalDe(patrimonio, 'pasivo');
  const capitalCent = totalDe(patrimonio, 'capital');
  // Utilidad (o pérdida) acumulada aún no cerrada: cierra la ecuación contable
  const utilidadCent = totalDe(resultados, 'ingreso') - totalDe(resultados, 'costo') - totalDe(resultados, 'gasto');

  res.json({
    hasta,
    activos: presentar(patrimonio.filter((f) => f.tipo === 'activo')),
    pasivos: presentar(patrimonio.filter((f) => f.tipo === 'pasivo')),
    capital: presentar(patrimonio.filter((f) => f.tipo === 'capital')),
    totales: {
      activo: activoCent / 100,
      pasivo: pasivoCent / 100,
      capital: capitalCent / 100,
      utilidad_periodo: utilidadCent / 100,
      pasivo_mas_capital: (pasivoCent + capitalCent + utilidadCent) / 100,
      cuadrado: activoCent === pasivoCent + capitalCent + utilidadCent,
    },
  });
}));

/* ------------------------------------------------------ estado de resultados */

rutasEstados.get('/resultados', requierePermiso('contabilidad', 'ver'), envolver(async (req, res) => {
  const hasta = esMes(req.query.hasta) ? req.query.hasta : null;
  const desde = esMes(req.query.desde) ? req.query.desde : hasta;
  if (!desde || !hasta) {
    res.status(400).json({ error: 'desde y hasta (YYYY-MM) son obligatorios' });
    return;
  }

  const actual = await saldos(['ingreso', 'costo', 'gasto'], desde, hasta);

  // Período anterior de igual longitud, para el comparativo
  const n = largoRango(desde, hasta);
  const antHasta = mesMenos(desde, 1);
  const antDesde = mesMenos(desde, n);
  const anterior = await saldos(['ingreso', 'costo', 'gasto'], antDesde, antHasta);
  const antPorCodigo = new Map(anterior.map((f) => [f.codigo, f.saldoCent]));

  const ingresosCent = totalDe(actual, 'ingreso');
  const costosCent = totalDe(actual, 'costo');
  const gastosCent = totalDe(actual, 'gasto');
  const brutaCent = ingresosCent - costosCent;
  const netaCent = brutaCent - gastosCent;

  const antIngresos = totalDe(anterior, 'ingreso');
  const antNeta = antIngresos - totalDe(anterior, 'costo') - totalDe(anterior, 'gasto');

  const seccion = (tipo: string) =>
    actual
      .filter((f) => f.tipo === tipo && (f.saldoCent !== 0 || (antPorCodigo.get(f.codigo) ?? 0) !== 0))
      .map((f) => ({
        codigo: f.codigo, nombre: f.nombre, nivel: f.nivel, es_detalle: f.es_detalle,
        saldo: f.saldoCent / 100,
        anterior: (antPorCodigo.get(f.codigo) ?? 0) / 100,
      }));

  res.json({
    desde, hasta, anterior: { desde: antDesde, hasta: antHasta },
    ingresos: seccion('ingreso'),
    costos: seccion('costo'),
    gastos: seccion('gasto'),
    totales: {
      ingresos: ingresosCent / 100,
      costos: costosCent / 100,
      utilidad_bruta: brutaCent / 100,
      gastos: gastosCent / 100,
      utilidad_neta: netaCent / 100,
      margen_neto: ingresosCent > 0 ? netaCent / ingresosCent : 0,
      anterior_ingresos: antIngresos / 100,
      anterior_utilidad_neta: antNeta / 100,
    },
  });
}));

/* ------------------------------------------------------- cierre del ejercicio */

// Salda TODAS las cuentas de resultados (hasta el período dado) contra la
// cuenta de resultados acumulados, con un asiento tipo 'cierre'.
rutasEstados.post('/cerrar', requierePermiso('contabilidad', 'cerrar'), envolver(async (req, res) => {
  const { hasta } = req.body ?? {};
  if (!esMes(hasta)) {
    res.status(400).json({ error: 'hasta (YYYY-MM) es obligatorio' });
    return;
  }
  const p = await pool.query('SELECT estado FROM periodos WHERE ano_mes = $1', [hasta]);
  if (p.rowCount === 0 || p.rows[0].estado !== 'abierto') {
    res.status(400).json({ error: `El período ${hasta} no existe o no está abierto (el asiento de cierre entra ahí)` });
    return;
  }

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; asiento_id?: number; utilidad?: number }> => {
    const cfg = await leerConfig(bd, ['cuenta_resultados_acumulados']);
    const r = await bd.query(
      `SELECT m.cuenta, c.tipo, SUM(m.debito) AS d, SUM(m.credito) AS cr
       FROM movimientos m
       JOIN asientos a ON a.id = m.asiento_id
       JOIN cuentas c ON c.codigo = m.cuenta
       WHERE c.tipo IN ('ingreso', 'costo', 'gasto') AND a.ano_mes <= $1
       GROUP BY m.cuenta, c.tipo`,
      [hasta]
    );
    const porSaldar = r.rows
      .map((f) => ({ cuenta: f.cuenta, saldoCent: Math.round((Number(f.d) - Number(f.cr)) * 100) })) // + deudor
      .filter((f) => f.saldoCent !== 0);
    if (porSaldar.length === 0) return { error: 400, mensaje: 'No hay cuentas de resultados con saldo por cerrar' };

    const [a, m] = (hasta as string).split('-').map(Number);
    const ultimoDia = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
    const fecha = `${hasta}-${String(ultimoDia).padStart(2, '0')}`;

    const asiento = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, concepto, creado_por)
       VALUES ($1, $2, 'cierre', $3, $4) RETURNING id`,
      [fecha, hasta, `Cierre del ejercicio al ${fecha}`, req.usuario!.id]
    );
    const asientoId = asiento.rows[0].id;

    let utilidadCent = 0;  // acreedor positivo = utilidad
    for (const f of porSaldar) {
      // Saldar: si la cuenta quedó deudora (costos/gastos), se acredita; si acreedora (ingresos), se debita
      if (f.saldoCent > 0) {
        await bd.query(
          `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1,$2,0,$3,'cierre')`,
          [asientoId, f.cuenta, f.saldoCent / 100]
        );
        utilidadCent -= f.saldoCent;
      } else {
        await bd.query(
          `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1,$2,$3,0,'cierre')`,
          [asientoId, f.cuenta, -f.saldoCent / 100]
        );
        utilidadCent += -f.saldoCent;
      }
    }
    // La diferencia va a resultados acumulados (C si utilidad, D si pérdida)
    if (utilidadCent > 0) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1,$2,0,$3,'cierre')`,
        [asientoId, cfg.cuenta_resultados_acumulados, utilidadCent / 100]
      );
    } else if (utilidadCent < 0) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref) VALUES ($1,$2,$3,0,'cierre')`,
        [asientoId, cfg.cuenta_resultados_acumulados, -utilidadCent / 100]
      );
    }
    await registrarBitacora(bd, req.usuario!.id, 'cerrar_ejercicio', 'asientos', String(asientoId), {
      hasta,
      utilidad: utilidadCent / 100,
      cuentas_saldadas: porSaldar.length,
    });
    return { asiento_id: asientoId, utilidad: utilidadCent / 100 };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.status(201).json(resultado);
}));
