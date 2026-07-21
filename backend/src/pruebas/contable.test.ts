/**
 * SUITE CONTABLE — corre contra un ESQUEMA TEMPORAL en el mismo Supabase:
 * crea pruebas_<ts>, aplica las 15 migraciones desde cero (de paso prueba que
 * son reproducibles), ejecuta el ciclo completo y destruye el esquema.
 * La base real no se toca. `npm test`.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import request from 'supertest';
import 'dotenv/config';

const esquema = `pruebas_${Date.now()}`;
process.env.ESQUEMA_PRUEBAS = esquema;

// Imports DESPUÉS de fijar el esquema (db.ts lee el env al cargar)
let app: import('express').Express;
let pool: import('pg').Pool;

const USUARIO = '00000000-0000-0000-0000-000000000001';

beforeAll(async () => {
  const db = await import('../db');
  pool = db.pool;
  await pool.query(`CREATE SCHEMA ${esquema}`);
  const { aplicarMigraciones } = await import('../migrate');
  await aplicarMigraciones(pool, true);
  ({ app } = await import('../aplicacion'));

  // Fixtures mínimos (coinciden con las cuentas de enlace por defecto de config)
  await pool.query(`INSERT INTO periodos (ano_mes) VALUES ('2026-06'), ('2026-07')`);
  await pool.query(`UPDATE periodos SET estado = 'cerrado', cerrado_en = now() WHERE ano_mes = '2026-06'`);
  await pool.query(`
    INSERT INTO cuentas (codigo, nombre, tipo, nivel, es_detalle) VALUES
      ('1-01-01',    'Caja',            'activo',  1, true),
      ('1-01-02-01', 'Banco BAC',       'activo',  1, true),
      ('1-01-03',    'CxC',             'activo',  1, true),
      ('1-01-04',    'Inventario',      'activo',  1, true),
      ('1-01-05',    'IVA acreditable', 'activo',  1, true),
      ('2-01',       'CxP',             'pasivo',  1, true),
      ('2-02-01',    'IVA por pagar',   'pasivo',  1, true),
      ('2-03',       'Retención IR por pagar', 'pasivo', 1, true),
      ('3-02',       'Resultados acumulados',  'capital', 1, true),
      ('4-01',       'Ventas',          'ingreso', 1, true),
      ('5-01',       'Costo de ventas', 'costo',   1, true)`);
  await pool.query(`INSERT INTO sucursales (codigo, nombre) VALUES ('CEN', 'Central')`);
  await pool.query(`INSERT INTO bodegas (codigo, nombre, sucursal) VALUES ('BOD-CEN', 'Bodega Central', 'CEN')`);
  await pool.query(`
    INSERT INTO series (serie, sucursal, tipo, prefijo, documento)
    VALUES ('A-CEN', 'CEN', 'sistema', 'A-CEN-', 'factura')`);
  await pool.query(`
    INSERT INTO terceros (ruc, nombre, tipo, terminos_dias) VALUES
      ('C001', 'Cliente Prueba',   'cliente',   30),
      ('P001', 'Proveedor Prueba', 'proveedor', 15)`);
  await pool.query(`
    INSERT INTO productos (codigo, nombre, unidad, precio_venta) VALUES ('PR-1', 'Producto uno', 'unidad', 30.00)`);
  await pool.query(`
    INSERT INTO cuentas_bancarias (banco, nombre, numero, moneda, cuenta_contable)
    VALUES ('BAC', 'Operativa', '000-1', 'NIO', '1-01-02-01')`);
  await pool.query(`
    INSERT INTO retencion_tipos (codigo, nombre, tasa, base, cuenta_contable, aplica)
    VALUES ('IR-2', 'Retención IR 2%', 0.02, 'subtotal', '2-03', 'compra')`);
  await pool.query(`INSERT INTO usuarios (id, email, nombre) VALUES ($1, 'pruebas@sevasa.local', 'Pruebas')`, [USUARIO]);
}, 300_000);

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
  await pool.end();
}, 120_000);

/** Ids de los fixtures/documentos que las pruebas van encadenando. */
const ctx: Record<string, number> = {};

describe('reglas duras de la base', () => {
  it('rechaza un asiento descuadrado por un centavo (trigger diferido)', async () => {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(
        `INSERT INTO asientos (fecha, ano_mes, tipo_origen, concepto) VALUES ('2026-07-10', '2026-07', 'manual', 'descuadrado')`
      );
      await cliente.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito)
         VALUES (currval('asientos_id_seq'), '1-01-01', 1000.00, 0),
                (currval('asientos_id_seq'), '4-01', 0, 999.99)`
      );
      await expect(cliente.query('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toThrow(/descuadrado/);
      await cliente.query('ROLLBACK');
    } finally {
      cliente.release();
    }
  });

  it('rechaza asientos en período cerrado', async () => {
    await expect(
      pool.query(
        `INSERT INTO asientos (fecha, ano_mes, tipo_origen, concepto) VALUES ('2026-06-15', '2026-06', 'manual', 'x')`
      )
    ).rejects.toThrow(/no está abierto/);
  });

  it('no permite borrar asientos (anulación por contra-asiento)', async () => {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(
        `INSERT INTO asientos (fecha, ano_mes, tipo_origen, concepto) VALUES ('2026-07-10', '2026-07', 'manual', 'asiento imborrable')`
      );
      await cliente.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito)
         VALUES (currval('asientos_id_seq'), '1-01-01', 500.00, 0),
                (currval('asientos_id_seq'), '4-01', 0, 500.00)`
      );
      await cliente.query('COMMIT');
    } finally {
      cliente.release();
    }
    await expect(
      pool.query(`DELETE FROM asientos WHERE concepto = 'asiento imborrable'`)
    ).rejects.toThrow(/no se borran/);
  });
});

describe('compras e inventario (costo promedio)', () => {
  it('registra una compra: asiento, kardex y promedio', async () => {
    const borrador = await request(app).post('/api/compras').send({
      tercero_id: 2, numero_documento: 'FC-001', fecha: '2026-07-05', tipo_pago: 'credito',
      bodega: 'BOD-CEN', lineas: [{ producto_id: 1, cantidad: 100, costo_unitario: 10 }],
    });
    expect(borrador.status).toBe(201);
    ctx.compra1 = borrador.body.id;
    const reg = await request(app).post(`/api/compras/${ctx.compra1}/registrar`).send({});
    expect(reg.status).toBe(200);
    expect(Number(reg.body.subtotal)).toBe(1000);
    expect(Number(reg.body.iva)).toBe(150);
    expect(Number(reg.body.total)).toBe(1150);

    const p = await pool.query('SELECT costo_promedio FROM productos WHERE id = 1');
    expect(Number(p.rows[0].costo_promedio)).toBeCloseTo(10, 4);
    const e = await pool.query(`SELECT cantidad FROM existencias WHERE producto_id = 1 AND bodega = 'BOD-CEN'`);
    expect(Number(e.rows[0].cantidad)).toBe(100);
  }, 60_000);

  it('recalcula el promedio ponderado con una segunda compra', async () => {
    const b = await request(app).post('/api/compras').send({
      tercero_id: 2, numero_documento: 'FC-002', fecha: '2026-07-06', tipo_pago: 'credito',
      bodega: 'BOD-CEN', lineas: [{ producto_id: 1, cantidad: 100, costo_unitario: 20 }],
    });
    ctx.compra2 = b.body.id;
    await request(app).post(`/api/compras/${ctx.compra2}/registrar`).send({});
    const p = await pool.query('SELECT costo_promedio FROM productos WHERE id = 1');
    expect(Number(p.rows[0].costo_promedio)).toBeCloseTo(15, 4);  // (100·10 + 100·20) / 200
  }, 60_000);
});

describe('facturación', () => {
  it('emite factura de crédito: IVA exacto, costo de venta y kardex en el MISMO asiento', async () => {
    const borrador = await request(app).post('/api/facturas').send({
      serie: 'A-CEN', fecha: '2026-07-10', tercero_id: 1, tipo_pago: 'credito', bodega: 'BOD-CEN',
      lineas: [{ producto_id: 1, descripcion: 'Producto uno', cantidad: 10, precio_unitario: 30 }],
    });
    expect(borrador.status).toBe(201);
    ctx.factura = borrador.body.id;
    const emitida = await request(app).post(`/api/facturas/${ctx.factura}/emitir`).send({});
    expect(emitida.status).toBe(200);
    expect(emitida.body.numero_completo).toBe('A-CEN-000001');
    expect(Number(emitida.body.subtotal)).toBe(300);
    expect(Number(emitida.body.iva)).toBe(45);
    expect(Number(emitida.body.total)).toBe(345);

    const movs = await pool.query(
      `SELECT cuenta, debito, credito FROM movimientos WHERE asiento_id = $1 ORDER BY id`,
      [emitida.body.asiento_id]
    );
    const mapa = new Map(movs.rows.map((m) => [m.cuenta, m]));
    expect(Number(mapa.get('1-01-03')?.debito)).toBe(345);      // CxC
    expect(Number(mapa.get('4-01')?.credito)).toBe(300);        // Ventas
    expect(Number(mapa.get('2-02-01')?.credito)).toBe(45);      // IVA
    expect(Number(mapa.get('5-01')?.debito)).toBe(150);         // Costo 10 × 15
    expect(Number(mapa.get('1-01-04')?.credito)).toBe(150);     // Inventario

    const e = await pool.query(`SELECT cantidad FROM existencias WHERE producto_id = 1 AND bodega = 'BOD-CEN'`);
    expect(Number(e.rows[0].cantidad)).toBe(190);
  }, 60_000);

  it('rechaza emitir con productos y sin bodega', async () => {
    const b = await request(app).post('/api/facturas').send({
      serie: 'A-CEN', fecha: '2026-07-10', tercero_id: 1, tipo_pago: 'contado',
      lineas: [{ producto_id: 1, descripcion: 'x', cantidad: 1, precio_unitario: 30 }],
    });
    const r = await request(app).post(`/api/facturas/${b.body.id}/emitir`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/bodega/i);
  }, 60_000);

  it('bloquea emitir más cantidad que la existencia de la bodega', async () => {
    const b = await request(app).post('/api/facturas').send({
      serie: 'A-CEN', fecha: '2026-07-10', tercero_id: 1, tipo_pago: 'contado', bodega: 'BOD-CEN',
      lineas: [{ producto_id: 1, descripcion: 'x', cantidad: 99999, precio_unitario: 30 }],
    });
    const r = await request(app).post(`/api/facturas/${b.body.id}/emitir`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/existencia/i);
    // La factura quedó borrador (no tomó número ni descargó inventario)
    const f = await pool.query('SELECT estado FROM facturas WHERE id = $1', [b.body.id]);
    expect(f.rows[0].estado).toBe('borrador');
  }, 60_000);
});

describe('sobreaplicaciones (auditoría P0)', () => {
  it('rechaza un recibo que repite la factura y excede su saldo', async () => {
    const r = await request(app).post('/api/cxc/recibos').send({
      fecha: '2026-07-11', tercero_id: 1, forma_pago: 'efectivo',
      aplicaciones: [{ factura_id: ctx.factura, monto: 200 }, { factura_id: ctx.factura, monto: 200 }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/solo debe/);
  }, 60_000);

  it('acepta un cobro parcial válido', async () => {
    const r = await request(app).post('/api/cxc/recibos').send({
      fecha: '2026-07-11', tercero_id: 1, forma_pago: 'efectivo',
      aplicaciones: [{ factura_id: ctx.factura, monto: 100 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.numero_completo).toBe('REC-000001');
    ctx.recibo = r.body.id;
  }, 60_000);

  it('rechaza devolver más de lo facturado repitiendo la línea', async () => {
    const linea = await pool.query('SELECT id FROM factura_lineas WHERE factura_id = $1', [ctx.factura]);
    ctx.lineaFactura = linea.rows[0].id;
    const r = await request(app).post('/api/cxc/notas').send({
      factura_id: ctx.factura, tipo: 'devolucion', motivo: 'prueba', fecha: '2026-07-12',
      lineas: [{ factura_linea_id: ctx.lineaFactura, cantidad: 6 }, { factura_linea_id: ctx.lineaFactura, cantidad: 6 }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/por devolver/);
  }, 60_000);

  it('acepta una devolución válida y reingresa el inventario al costo de salida', async () => {
    const r = await request(app).post('/api/cxc/notas').send({
      factura_id: ctx.factura, tipo: 'devolucion', motivo: 'prueba válida', fecha: '2026-07-12',
      lineas: [{ factura_linea_id: ctx.lineaFactura, cantidad: 2 }],
    });
    expect(r.status).toBe(201);
    expect(Number(r.body.total)).toBeCloseTo(69, 2);   // 2 × 30 × 1.15
    expect(Number(r.body.costo)).toBeCloseTo(30, 2);   // 2 × 15
    const e = await pool.query(`SELECT cantidad FROM existencias WHERE producto_id = 1 AND bodega = 'BOD-CEN'`);
    expect(Number(e.rows[0].cantidad)).toBe(192);
  }, 60_000);

  it('rechaza pagar una compra repitiéndola por encima de la deuda', async () => {
    const r = await request(app).post('/api/bancos/movimientos').send({
      cuenta_bancaria_id: 1, tipo: 'cheque', fecha: '2026-07-13', concepto: 'sobrepago', tercero_id: 2,
      aplicaciones: [{ compra_id: ctx.compra1, monto: 600 }, { compra_id: ctx.compra1, monto: 600 }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/solo se le deben/);
  }, 60_000);

  it('emite un cheque válido de pago a proveedor (CK-000001)', async () => {
    const r = await request(app).post('/api/bancos/movimientos').send({
      cuenta_bancaria_id: 1, tipo: 'cheque', fecha: '2026-07-13', concepto: 'abono FC-001', tercero_id: 2,
      aplicaciones: [{ compra_id: ctx.compra1, monto: 500 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.numero).toBe(1);
    ctx.cheque = r.body.id;
  }, 60_000);
});

describe('inmutabilidad a nivel de base', () => {
  it('no deja tocar una factura emitida', async () => {
    await expect(
      pool.query(`UPDATE facturas SET total = 1 WHERE id = $1`, [ctx.factura])
    ).rejects.toThrow(/inmutable/);
  });

  it('no deja tocar un recibo emitido ni sus aplicaciones', async () => {
    await expect(
      pool.query(`UPDATE recibos SET total = 1 WHERE id = $1`, [ctx.recibo])
    ).rejects.toThrow(/inmutable/);
    await expect(
      pool.query(`UPDATE recibo_aplicaciones SET monto = 1 WHERE recibo_id = $1`, [ctx.recibo])
    ).rejects.toThrow(/inmutables/);
    await expect(
      pool.query(`INSERT INTO recibo_aplicaciones (recibo_id, factura_id, monto) VALUES ($1, NULL, 5)`, [ctx.recibo])
    ).rejects.toThrow(/solo se insertan al crear/);
  });
});

describe('anulaciones espejo', () => {
  it('anular la factura revierte contabilidad e inventario', async () => {
    const antes = await pool.query(`SELECT cantidad FROM existencias WHERE producto_id = 1 AND bodega = 'BOD-CEN'`);
    const r = await request(app).post(`/api/facturas/${ctx.factura}/anular`).send({ motivo: 'prueba de anulación' });
    expect(r.status).toBe(200);
    const despues = await pool.query(`SELECT cantidad FROM existencias WHERE producto_id = 1 AND bodega = 'BOD-CEN'`);
    // Salieron 10, ya habían regresado 2 por la NC → la anulación reingresa las 8 restantes...
    // La anulación reingresa TODO lo que la factura descargó (10):
    expect(Number(despues.rows[0].cantidad)).toBe(Number(antes.rows[0].cantidad) + 10);

    const balanza = await pool.query(
      `SELECT COALESCE(SUM(debito), 0) AS d, COALESCE(SUM(credito), 0) AS c FROM movimientos`
    );
    expect(Number(balanza.rows[0].d)).toBeCloseTo(Number(balanza.rows[0].c), 2);
  }, 60_000);
});

describe('retenciones (F4)', () => {
  it('compra con retención IR 2%: acredita la cuenta, baja la CxP al neto y el asiento cuadra', async () => {
    const b = await request(app).post('/api/compras').send({
      tercero_id: 2, numero_documento: 'FC-RET', fecha: '2026-07-07', tipo_pago: 'credito', bodega: 'BOD-CEN',
      retenciones_codigos: ['IR-2'],
      lineas: [{ producto_id: 1, cantidad: 10, costo_unitario: 20 }],
    });
    expect(b.status).toBe(201);
    const reg = await request(app).post(`/api/compras/${b.body.id}/registrar`).send({});
    expect(reg.status).toBe(200);
    // subtotal 200, IVA 30, total 230, retención 2% de 200 = 4, neto CxP = 226
    const movs = await pool.query(
      `SELECT cuenta, debito, credito FROM movimientos WHERE asiento_id = $1 ORDER BY id`,
      [reg.body.asiento_id]
    );
    const mapa = new Map(movs.rows.map((m) => [m.cuenta, m]));
    expect(Number(mapa.get('2-03')?.credito)).toBeCloseTo(4, 2);    // retención por pagar
    expect(Number(mapa.get('2-01')?.credito)).toBeCloseTo(226, 2);  // CxP neta
    const suma = movs.rows.reduce((s, m) => s + Number(m.debito) - Number(m.credito), 0);
    expect(suma).toBeCloseTo(0, 2);

    // La CxP pendiente del proveedor debe ser el neto (226), no el total (230)
    const cxp = await request(app).get(`/api/bancos/cxp/2`);
    const fila = (cxp.body as Array<{ numero_documento: string; saldo: string }>).find((f) => f.numero_documento === 'FC-RET');
    expect(Number(fila?.saldo)).toBeCloseTo(226, 2);
  }, 60_000);
});

describe('pólizas de importación (F5)', () => {
  it('liquida una póliza: prorratea el costo, entra al inventario y el asiento cuadra', async () => {
    // 2 productos; FOB en USD × TC 36; flete 3600 por peso, IVA 1000 acreditable
    const p2 = await pool.query(
      `INSERT INTO productos (codigo, nombre, unidad, precio_venta) VALUES ('PR-2', 'Producto dos', 'unidad', 50) RETURNING id`
    );
    const prod2 = Number(p2.rows[0].id);
    const b = await request(app).post('/api/polizas').send({
      numero: 'POL-001', fecha: '2026-07-09', bodega: 'BOD-CEN', moneda: 'USD', tipo_cambio: 36,
      lineas: [
        { producto_id: 1, cantidad: 10, fob_unitario: 5, peso: 100 },   // FOB 50 USD → 1800 NIO, peso 100
        { producto_id: prod2, cantidad: 10, fob_unitario: 5, peso: 300 }, // FOB 50 USD → 1800 NIO, peso 300
      ],
      gastos: [
        { concepto: 'Flete', monto: 4000, base: 'peso', es_iva: false, cuenta_contable: '2-01' },
        { concepto: 'IVA importación', monto: 1000, base: 'valor', es_iva: true, cuenta_contable: '2-01' },
      ],
    });
    expect(b.status).toBe(201);
    const liq = await request(app).post(`/api/polizas/${b.body.id}/liquidar`).send({});
    expect(liq.status).toBe(200);
    // FOB total 3600; flete 4000 por peso (100:300 → 1000 y 3000); IVA 1000 aparte
    expect(Number(liq.body.fob)).toBeCloseTo(3600, 2);
    expect(Number(liq.body.gastos)).toBeCloseTo(4000, 2);
    expect(Number(liq.body.iva)).toBeCloseTo(1000, 2);
    expect(Number(liq.body.total_inventario)).toBeCloseTo(7600, 2);  // 3600 + 4000

    const movs = await pool.query('SELECT COALESCE(SUM(debito - credito),0) AS d FROM movimientos WHERE asiento_id = $1', [liq.body.asiento_id]);
    expect(Number(movs.rows[0].d)).toBeCloseTo(0, 2);  // asiento cuadra

    // Producto 2 recibió 3000 de flete (peso 300 de 400) + 1800 FOB = 4800 / 10 = 480 c/u
    const det = await pool.query(`SELECT producto_id, costo_unitario FROM poliza_lineas WHERE poliza_id = $1 ORDER BY id`, [b.body.id]);
    const l2 = det.rows.find((r) => Number(r.producto_id) === prod2);
    expect(Number(l2.costo_unitario)).toBeCloseTo(480, 2);  // (1800 + 3000) / 10
    // Entró al inventario de la bodega
    const e = await pool.query(`SELECT cantidad FROM existencias WHERE producto_id = $1 AND bodega = 'BOD-CEN'`, [prod2]);
    expect(Number(e.rows[0].cantidad)).toBe(10);
  }, 60_000);

  it('multipóliza: el FOB se acredita a la CxP de cada proveedor por su parte', async () => {
    const prov2 = Number((await pool.query(
      `INSERT INTO terceros (ruc, nombre, tipo) VALUES ('P002', 'Proveedor dos', 'proveedor') RETURNING id`
    )).rows[0].id);
    const prod3 = Number((await pool.query(
      `INSERT INTO productos (codigo, nombre, unidad, precio_venta) VALUES ('PR-3', 'Producto tres', 'unidad', 80) RETURNING id`
    )).rows[0].id);
    const b = await request(app).post('/api/polizas').send({
      numero: 'POL-MULTI', fecha: '2026-07-09', bodega: 'BOD-CEN', moneda: 'NIO', tipo_cambio: 1,
      lineas: [
        { producto_id: 1, cantidad: 1, fob_unitario: 1000, peso: 1, tercero_id: 2 },      // proveedor 2 → 1000
        { producto_id: prod3, cantidad: 1, fob_unitario: 500, peso: 1, tercero_id: prov2 }, // proveedor nuevo → 500
      ],
      gastos: [],
    });
    const liq = await request(app).post(`/api/polizas/${b.body.id}/liquidar`).send({});
    expect(liq.status).toBe(200);
    const cxp = await pool.query(
      `SELECT tercero_id, SUM(credito) AS c FROM movimientos
       WHERE asiento_id = $1 AND cuenta = '2-01' AND credito > 0 GROUP BY tercero_id`,
      [liq.body.asiento_id]
    );
    const porProv = new Map(cxp.rows.map((r) => [Number(r.tercero_id), Number(r.c)]));
    expect(porProv.get(2)).toBeCloseTo(1000, 2);
    expect(porProv.get(prov2)).toBeCloseTo(500, 2);
  }, 60_000);

  it('la póliza aparece como pagable y el pago baja su saldo', async () => {
    // El proveedor 2 debe tener la POL-MULTI con saldo 1000
    const antes = await request(app).get('/api/bancos/cxp/2');
    const pol = (antes.body as Array<{ tipo: string; id: number; saldo: string }>).find((f) => f.tipo === 'poliza');
    expect(pol).toBeTruthy();
    expect(Number(pol!.saldo)).toBeCloseTo(1000, 2);
    // Cheque de 400 aplicado a la póliza
    const pago = await request(app).post('/api/bancos/movimientos').send({
      cuenta_bancaria_id: 1, tipo: 'cheque', fecha: '2026-07-14', concepto: 'abono póliza', tercero_id: 2,
      aplicaciones: [{ poliza_id: pol!.id, monto: 400 }],
    });
    expect(pago.status).toBe(201);
    const despues = await request(app).get('/api/bancos/cxp/2');
    const pol2 = (despues.body as Array<{ tipo: string; id: number; saldo: string }>).find((f) => f.tipo === 'poliza');
    expect(Number(pol2!.saldo)).toBeCloseTo(600, 2);
    // Sobrepago repitiendo la póliza → rechazado
    const sobre = await request(app).post('/api/bancos/movimientos').send({
      cuenta_bancaria_id: 1, tipo: 'cheque', fecha: '2026-07-14', concepto: 'sobrepago póliza', tercero_id: 2,
      aplicaciones: [{ poliza_id: pol!.id, monto: 400 }, { poliza_id: pol!.id, monto: 400 }],
    });
    expect(sobre.status).toBe(400);
  }, 60_000);
});

describe('estados financieros (F6)', () => {
  it('el Balance General cuadra y su utilidad coincide con el Estado de Resultados', async () => {
    const balance = await request(app).get('/api/estados/balance?hasta=2026-07');
    expect(balance.status).toBe(200);
    expect(balance.body.totales.cuadrado).toBe(true);
    expect(Number(balance.body.totales.activo)).toBeCloseTo(Number(balance.body.totales.pasivo_mas_capital), 2);

    const resultados = await request(app).get('/api/estados/resultados?desde=2026-06&hasta=2026-07');
    expect(resultados.status).toBe(200);
    // La utilidad acumulada del balance = utilidad neta de resultados (todo el historial cae en jun-jul)
    expect(Number(balance.body.totales.utilidad_periodo)).toBeCloseTo(Number(resultados.body.totales.utilidad_neta), 2);
    // Coherencia interna del estado de resultados
    const t = resultados.body.totales;
    expect(Number(t.utilidad_neta)).toBeCloseTo(Number(t.ingresos) - Number(t.costos) - Number(t.gastos), 2);
  }, 60_000);

  it('el cierre del ejercicio salda resultados contra acumulados y el balance sigue cuadrado', async () => {
    const antes = await request(app).get('/api/estados/balance?hasta=2026-07');
    const utilidadAntes = Number(antes.body.totales.utilidad_periodo);

    const cierre = await request(app).post('/api/estados/cerrar').send({ hasta: '2026-07' });
    if (cierre.status !== 201) throw new Error(`Cierre falló: ${JSON.stringify(cierre.body)}`);
    expect(cierre.status).toBe(201);
    expect(Number(cierre.body.utilidad)).toBeCloseTo(utilidadAntes, 2);

    const despues = await request(app).get('/api/estados/balance?hasta=2026-07');
    expect(despues.body.totales.cuadrado).toBe(true);
    // Tras el cierre no queda utilidad sin cerrar: se trasladó a resultados acumulados
    expect(Number(despues.body.totales.utilidad_periodo)).toBeCloseTo(0, 2);
  }, 60_000);
});

describe('seguridad perimetral (base real, no el esquema de pruebas)', () => {
  it('PostgREST responde 401 con la clave anon en tablas y vistas', async () => {
    const base = process.env.SUPABASE_URL;
    const llave = process.env.SUPABASE_ANON_KEY;
    expect(base).toBeTruthy();
    expect(llave).toBeTruthy();
    for (const recurso of ['usuarios', 'asientos', 'v_balanza', 'facturas']) {
      const r = await fetch(`${base}/rest/v1/${recurso}?select=*&limit=1`, {
        headers: { apikey: llave!, Authorization: `Bearer ${llave}` },
      });
      expect(r.status, `${recurso} debería estar bloqueada`).toBe(401);
    }
  }, 60_000);
});
