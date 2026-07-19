/**
 * Siembra DATOS DE PRUEBA (ficticios) para ejercitar las pantallas de F1:
 * catálogo estilo Nicaragua, períodos, terceros, tipo de cambio y asientos
 * de ejemplo (apertura, ventas con IVA 15%, costo, compra, gastos, cobros).
 *
 *   npm run seed
 *
 * Se niega a correr si ya hay cuentas (no mezcla con datos reales).
 * Para reiniciar la base desde cero: borrar el esquema en Supabase y volver
 * a correr `npm run migrate` + `npm run seed`.
 */
import { pool, enTransaccion } from './db';

interface Linea {
  cuenta: string;
  debito?: number;
  credito?: number;
  tercero?: number;
  moneda?: 'NIO' | 'USD';
  tipo_cambio?: number;
  monto_origen?: number;
}

// codigo, nombre, tipo, padre, es_detalle
const CUENTAS: Array<[string, string, string, string | null, boolean]> = [
  ['1',        'ACTIVO',                  'activo',  null,      false],
  ['1-01',     'Activo circulante',       'activo',  '1',       false],
  ['1-01-01',  'Caja general',            'activo',  '1-01',    true],
  ['1-01-02',  'Bancos',                  'activo',  '1-01',    false],
  ['1-01-02-01', 'BAC córdobas',          'activo',  '1-01-02', true],
  ['1-01-02-02', 'Lafise dólares',        'activo',  '1-01-02', true],
  ['1-01-03',  'Cuentas por cobrar',      'activo',  '1-01',    true],
  ['1-01-04',  'Inventario',              'activo',  '1-01',    true],
  ['2',        'PASIVO',                  'pasivo',  null,      false],
  ['2-01',     'Cuentas por pagar',       'pasivo',  '2',       true],
  ['2-02',     'Impuestos por pagar',     'pasivo',  '2',       false],
  ['2-02-01',  'IVA por pagar (15%)',     'pasivo',  '2-02',    true],
  ['3',        'CAPITAL',                 'capital', null,      false],
  ['3-01',     'Capital social',          'capital', '3',       true],
  ['3-02',     'Resultados acumulados',   'capital', '3',       true],
  ['4',        'INGRESOS',                'ingreso', null,      false],
  ['4-01',     'Ventas',                  'ingreso', '4',       true],
  ['5',        'COSTOS',                  'costo',   null,      false],
  ['5-01',     'Costo de ventas',         'costo',   '5',       true],
  ['6',        'GASTOS',                  'gasto',   null,      false],
  ['6-01',     'Gastos de administración','gasto',   '6',       false],
  ['6-01-01',  'Salarios',                'gasto',   '6-01',    true],
  ['6-01-02',  'Energía eléctrica',       'gasto',   '6-01',    true],
];

const TERCEROS: Array<[string, string, string]> = [
  ['J0310000000001', 'Distribuidora El Progreso S.A.', 'cliente'],
  ['0012345670001A', 'Juan Pérez (ferretería)',        'cliente'],
  ['J0310000000099', 'Importadora Centroamericana',    'proveedor'],
  ['J0310000000077', 'Mayorista La Económica',         'proveedor'],
];

async function nivelDe(codigo: string): Promise<number> {
  return codigo.split('-').length;
}

async function sembrar(): Promise<void> {
  const existentes = await pool.query('SELECT count(*)::int AS n FROM cuentas');
  if ((existentes.rows[0]?.n ?? 0) > 0) {
    console.log('⚠️  Ya hay cuentas en la base — no siembro nada para no mezclar datos.');
    console.log('    Para reiniciar: borrar esquema y correr npm run migrate + npm run seed.');
    return;
  }

  await enTransaccion(async (bd) => {
    // Períodos
    await bd.query(`INSERT INTO periodos (ano_mes) VALUES ('2026-06'), ('2026-07')`);

    // Catálogo
    for (const [codigo, nombre, tipo, padre, esDetalle] of CUENTAS) {
      await bd.query(
        `INSERT INTO cuentas (codigo, nombre, tipo, padre, nivel, es_detalle, moneda)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [codigo, nombre, tipo, padre, await nivelDe(codigo), esDetalle,
         codigo === '1-01-02-02' ? 'USD' : 'NIO']
      );
    }
    console.log(`✅ ${CUENTAS.length} cuentas`);

    // Terceros (ids 1..4 en orden de inserción)
    for (const [ruc, nombre, tipo] of TERCEROS) {
      await bd.query(`INSERT INTO terceros (ruc, nombre, tipo, terminos_dias) VALUES ($1, $2, $3, $4)`, [
        ruc, nombre, tipo, tipo === 'cliente' ? 30 : 15,
      ]);
    }
    console.log(`✅ ${TERCEROS.length} terceros`);

    // Tipo de cambio oficial de referencia
    await bd.query(`INSERT INTO tipos_cambio (fecha, tasa) VALUES ('2026-06-01', 36.80), ('2026-07-01', 36.95)`);

    // Asientos
    const asientos: Array<[string, string, string, Linea[]]> = [
      ['2026-06-01', 'apertura', 'Saldos iniciales al 01/06/2026', [
        { cuenta: '1-01-01',    debito: 50000 },
        { cuenta: '1-01-02-01', debito: 250000 },
        { cuenta: '1-01-02-02', debito: 36800, moneda: 'USD', tipo_cambio: 36.8, monto_origen: 1000 },
        { cuenta: '1-01-03',    debito: 120000, tercero: 1 },
        { cuenta: '1-01-04',    debito: 300000 },
        { cuenta: '2-01',       credito: 180000, tercero: 3 },
        { cuenta: '3-01',       credito: 500000 },
        { cuenta: '3-02',       credito: 76800 },
      ]],
      ['2026-06-10', 'manual', 'Venta de contado del día (fact. A-0001)', [
        { cuenta: '1-01-01', debito: 23000 },
        { cuenta: '4-01',    credito: 20000 },
        { cuenta: '2-02-01', credito: 3000 },
      ]],
      ['2026-06-10', 'manual', 'Costo de la venta A-0001', [
        { cuenta: '5-01',    debito: 12000 },
        { cuenta: '1-01-04', credito: 12000 },
      ]],
      ['2026-06-15', 'manual', 'Venta al crédito a Juan Pérez (fact. A-0002, 30 días)', [
        { cuenta: '1-01-03', debito: 34500, tercero: 2 },
        { cuenta: '4-01',    credito: 30000 },
        { cuenta: '2-02-01', credito: 4500 },
      ]],
      ['2026-06-15', 'manual', 'Costo de la venta A-0002', [
        { cuenta: '5-01',    debito: 18000 },
        { cuenta: '1-01-04', credito: 18000 },
      ]],
      ['2026-06-20', 'manual', 'Compra de inventario al crédito (Mayorista La Económica)', [
        { cuenta: '1-01-04', debito: 80000 },
        { cuenta: '2-01',    credito: 80000, tercero: 4 },
      ]],
      ['2026-06-28', 'manual', 'Planilla de junio', [
        { cuenta: '6-01-01',    debito: 45000 },
        { cuenta: '1-01-02-01', credito: 45000 },
      ]],
      ['2026-06-30', 'manual', 'Energía eléctrica junio', [
        { cuenta: '6-01-02',    debito: 6500 },
        { cuenta: '1-01-02-01', credito: 6500 },
      ]],
      ['2026-07-05', 'manual', 'Cobro parcial a Distribuidora El Progreso (recibo R-0001)', [
        { cuenta: '1-01-02-01', debito: 60000 },
        { cuenta: '1-01-03',    credito: 60000, tercero: 1 },
      ]],
      ['2026-07-08', 'manual', 'Abono a Importadora Centroamericana (ck 0001)', [
        { cuenta: '2-01',       debito: 50000, tercero: 3 },
        { cuenta: '1-01-02-01', credito: 50000 },
      ]],
      ['2026-07-12', 'manual', 'Venta de contado del día (fact. A-0003)', [
        { cuenta: '1-01-01', debito: 11500 },
        { cuenta: '4-01',    credito: 10000 },
        { cuenta: '2-02-01', credito: 1500 },
      ]],
      ['2026-07-12', 'manual', 'Costo de la venta A-0003', [
        { cuenta: '5-01',    debito: 6000 },
        { cuenta: '1-01-04', credito: 6000 },
      ]],
    ];

    for (const [fecha, tipo, concepto, lineas] of asientos) {
      const a = await bd.query(
        `INSERT INTO asientos (fecha, ano_mes, tipo_origen, concepto)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [fecha, fecha.slice(0, 7), tipo, concepto]
      );
      for (const l of lineas) {
        await bd.query(
          `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, moneda, tipo_cambio, monto_origen, tercero_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [a.rows[0].id, l.cuenta, l.debito ?? 0, l.credito ?? 0, l.moneda ?? 'NIO',
           l.tipo_cambio ?? null, l.monto_origen ?? null, l.tercero ?? null]
        );
      }
    }
    console.log(`✅ ${asientos.length} asientos de ejemplo (junio y julio)`);

    // Series de facturación de prueba (F2)
    await bd.query(`
      INSERT INTO series (serie, tienda, tipo, prefijo) VALUES
        ('A-CEN', 'Sucursal Central', 'sistema', 'A-CEN-'),
        ('A-SUR', 'Sucursal Sur',     'sistema', 'A-SUR-')
      ON CONFLICT DO NOTHING`);
    console.log('✅ 2 series de facturación');

    // Junio queda cerrado para demostrar el candado de período
    await bd.query(`UPDATE periodos SET estado = 'cerrado', cerrado_en = now() WHERE ano_mes = '2026-06'`);
    console.log('🔒 Período 2026-06 cerrado (probá tocarlo: la BD lo rechaza)');
  });

  const totales = await pool.query(
    `SELECT COALESCE(SUM(debito), 0) AS d, COALESCE(SUM(credito), 0) AS c FROM movimientos`
  );
  const { d, c } = totales.rows[0];
  console.log(`✨ Sembrado completo — débitos ${d} = créditos ${c} → ${Number(d) === Number(c) ? 'CUADRA ✅' : 'DESCUADRE ❌'}`);
}

sembrar()
  .then(() => pool.end())
  .catch((err) => {
    console.error('❌', err);
    process.exitCode = 1;
    return pool.end();
  });
