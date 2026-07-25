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
  // Las cuentas de login de la suite viven en auth.users (esquema REAL
  // compartido): se limpian siempre, incluidas las de corridas que fallaron
  await pool.query(`DELETE FROM auth.users WHERE email LIKE '%@pruebas-sevasa.local'`);
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
  it('rechaza líneas basura: sin descripción, con espacios o sin cantidad', async () => {
    const base = { serie: 'A-CEN', fecha: '2026-07-10', tercero_id: 1, tipo_pago: 'contado', bodega: 'BOD-CEN' };
    for (const linea of [
      { descripcion: '', cantidad: 1, precio_unitario: 100 },
      { descripcion: '   ', cantidad: 1, precio_unitario: 100 },   // solo espacios
      { descripcion: 'Servicio', cantidad: 0, precio_unitario: 100 },
      { descripcion: 'Servicio', cantidad: 1, precio_unitario: -5 },
    ]) {
      const r = await request(app).post('/api/facturas').send({ ...base, lineas: [linea] });
      expect(r.status, `debería rechazar ${JSON.stringify(linea)}`).toBe(400);
    }
    // y la descripción válida se graba SIN los espacios de sobra
    const ok = await request(app).post('/api/facturas').send({
      ...base, lineas: [{ descripcion: '  Servicio de instalación  ', cantidad: 1, precio_unitario: 100 }],
    });
    expect(ok.status).toBe(201);
    const l = await pool.query('SELECT descripcion FROM factura_lineas WHERE factura_id = $1', [ok.body.id]);
    expect(l.rows[0].descripcion).toBe('Servicio de instalación');
    await request(app).delete(`/api/facturas/${ok.body.id}`);
  }, 60_000);

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

describe('compra de contado con caja elegida', () => {
  it('acredita la caja indicada en cuenta_pago, no la general', async () => {
    const b = await request(app).post('/api/compras').send({
      tercero_id: 2, numero_documento: 'FC-CAJA', fecha: '2026-07-08', tipo_pago: 'contado',
      bodega: 'BOD-CEN', cuenta_pago: '1-01-02-01',   // banco BAC como "caja" elegida
      lineas: [{ producto_id: 1, cantidad: 1, costo_unitario: 100 }],
    });
    expect(b.status).toBe(201);
    const reg = await request(app).post(`/api/compras/${b.body.id}/registrar`).send({});
    expect(reg.status).toBe(200);
    const movs = await pool.query(
      `SELECT cuenta, credito FROM movimientos WHERE asiento_id = $1 AND credito > 0`,
      [reg.body.asiento_id]
    );
    expect(movs.rows).toHaveLength(1);
    expect(movs.rows[0].cuenta).toBe('1-01-02-01');   // la elegida, no 1-01-01
    expect(Number(movs.rows[0].credito)).toBeCloseTo(115, 2);
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

describe('bitácora', () => {
  it('todas las operaciones del ciclo quedaron registradas y la consulta filtra', async () => {
    const r = await request(app).get('/api/bitacora?por_pagina=200');
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThan(5);
    const acciones = new Set((r.body.filas as Array<{ accion: string }>).map((f) => f.accion));
    for (const esperada of ['registrar_compra', 'emitir_factura', 'emitir_recibo', 'anular_factura', 'liquidar_poliza', 'cerrar_ejercicio']) {
      expect(acciones.has(esperada), `falta ${esperada} en la bitácora`).toBe(true);
    }
    const filtrada = await request(app).get('/api/bitacora?accion=emitir_factura');
    expect((filtrada.body.filas as Array<{ accion: string }>).every((f) => f.accion === 'emitir_factura')).toBe(true);
  }, 60_000);
});

describe('administración de usuarios (ficha + credenciales + roles)', () => {
  const email = `${esquema}@pruebas-sevasa.local`;
  let nuevoId = '';

  it('crea el usuario completo en una transacción (login + ficha + roles)', async () => {
    const r = await request(app).post('/api/usuarios').send({
      email, clave: 'Clave-Segura-1', nombre: 'Vendedora Prueba',
      cedula: '001-010190-0001A', telefono: '8888-0000', cargo: 'Vendedora',
      sucursal: 'CEN', bodega: 'BOD-CEN', roles: ['facturador'],
    });
    expect(r.status).toBe(201);
    nuevoId = r.body.id;

    const lista = await request(app).get('/api/usuarios');
    expect(lista.status).toBe(200);
    const fila = (lista.body as Array<Record<string, unknown>>).find((u) => u.email === email);
    expect(fila).toBeTruthy();
    expect(fila!.nombre).toBe('Vendedora Prueba');
    expect(fila!.sucursal).toBe('CEN');
    expect(fila!.roles).toEqual(['facturador']);

    // La cuenta de login quedó en auth (esquema REAL compartido; se limpia al final)
    const enAuth = await pool.query('SELECT email_confirmed_at FROM auth.users WHERE id = $1', [nuevoId]);
    expect(enAuth.rowCount).toBe(1);
    expect(enAuth.rows[0].email_confirmed_at).toBeTruthy();
  }, 60_000);

  it('rechaza correo duplicado, clave corta y usuario sin rol', async () => {
    const dup = await request(app).post('/api/usuarios').send({
      email, clave: 'Clave-Segura-1', nombre: 'Duplicada', roles: ['consulta'],
    });
    expect(dup.status).toBe(409);
    const corta = await request(app).post('/api/usuarios').send({
      email: `otra-${esquema}@pruebas-sevasa.local`, clave: 'corta', nombre: 'X', roles: ['consulta'],
    });
    expect(corta.status).toBe(400);
    const sinRol = await request(app).post('/api/usuarios').send({
      email: `otra-${esquema}@pruebas-sevasa.local`, clave: 'Clave-Segura-1', nombre: 'X', roles: [],
    });
    expect(sinRol.status).toBe(400);
  }, 60_000);

  it('edita ficha, cambia roles, desactiva y resetea la clave (todo en bitácora)', async () => {
    const ed = await request(app).put(`/api/usuarios/${nuevoId}`).send({
      cargo: 'Cajera', roles: ['cajero'], activo: false,
    });
    expect(ed.status).toBe(200);
    const lista = await request(app).get('/api/usuarios');
    const fila = (lista.body as Array<Record<string, unknown>>).find((u) => u.email === email);
    expect(fila!.cargo).toBe('Cajera');
    expect(fila!.roles).toEqual(['cajero']);
    expect(fila!.activo).toBe(false);

    const reset = await request(app).post(`/api/usuarios/${nuevoId}/reset-clave`).send({ clave: 'Nueva-Clave-9' });
    expect(reset.status).toBe(200);

    const b = await request(app).get('/api/bitacora?por_pagina=50');
    const acciones = new Set((b.body.filas as Array<{ accion: string }>).map((f) => f.accion));
    for (const esperada of ['crear_usuario', 'editar_usuario', 'reset_clave']) {
      expect(acciones.has(esperada), `falta ${esperada} en la bitácora`).toBe(true);
    }
  }, 60_000);
});

describe('amarres duros por sucursal y bodega (enforcement)', () => {
  beforeAll(async () => {
    await pool.query(`INSERT INTO sucursales (codigo, nombre) VALUES ('SUR', 'Tienda Sur')`);
    await pool.query(`INSERT INTO bodegas (codigo, nombre, sucursal) VALUES ('BOD-SUR', 'Bodega Sur', 'SUR')`);
    await pool.query(`
      INSERT INTO series (serie, sucursal, tipo, prefijo, documento)
      VALUES ('A-SUR', 'SUR', 'sistema', 'A-SUR-', 'factura')`);
    // requierePermiso valida los roles contra la BD: el usuario de pruebas
    // necesita las filas reales para actuar como no-admin
    await pool.query(
      `INSERT INTO usuario_roles (usuario_id, rol) VALUES ($1, 'facturador'), ($1, 'comprador') ON CONFLICT DO NOTHING`,
      [USUARIO]
    );
  });

  it('un facturador amarrado a SUR no puede usar la serie de otra sucursal', async () => {
    const simulado = JSON.stringify({ roles: ['facturador'], sucursal: 'SUR' });
    const ajena = await request(app).post('/api/facturas')
      .set('x-prueba-usuario', simulado)
      .send({ serie: 'A-CEN', fecha: '2026-07-20', tercero_id: 1, tipo_pago: 'contado',
              lineas: [{ descripcion: 'Servicio', cantidad: 1, precio_unitario: 100 }] });
    expect(ajena.status).toBe(403);
    expect(ajena.body.error).toMatch(/sucursal SUR/);

    const propia = await request(app).post('/api/facturas')
      .set('x-prueba-usuario', simulado)
      .send({ serie: 'A-SUR', fecha: '2026-07-20', tercero_id: 1, tipo_pago: 'contado',
              lineas: [{ descripcion: 'Servicio', cantidad: 1, precio_unitario: 100 }] });
    expect(propia.status).toBe(201);
  }, 60_000);

  it('un bodeguero amarrado a BOD-SUR no puede originar traslados desde otra bodega', async () => {
    const r = await request(app).post('/api/traslados')
      .set('x-prueba-usuario', JSON.stringify({ roles: ['comprador'], sucursal: 'SUR', bodega: 'BOD-SUR' }))
      .send({ fecha: '2026-07-20', bodega_origen: 'BOD-CEN', bodega_destino: 'BOD-SUR',
              lineas: [{ producto_id: 1, cantidad: 1 }] });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/bodega BOD-SUR/);
  }, 60_000);

  it('un usuario de la sucursal CEN sí traslada desde sus bodegas hacia otra tienda', async () => {
    const r = await request(app).post('/api/traslados')
      .set('x-prueba-usuario', JSON.stringify({ roles: ['comprador'], sucursal: 'CEN' }))
      .send({ fecha: '2026-07-20', bodega_origen: 'BOD-CEN', bodega_destino: 'BOD-SUR',
              lineas: [{ producto_id: 1, cantidad: 1 }] });
    expect(r.status).toBe(201);
  }, 60_000);

  it('los admins no tienen amarre (operan en todas las sucursales)', async () => {
    const r = await request(app).post('/api/facturas')
      .set('x-prueba-usuario', JSON.stringify({ roles: ['admin'], sucursal: 'SUR' }))
      .send({ serie: 'A-CEN', fecha: '2026-07-20', tercero_id: 1, tipo_pago: 'contado',
              lineas: [{ descripcion: 'Servicio', cantidad: 1, precio_unitario: 100 }] });
    expect(r.status).toBe(201);
  }, 60_000);
});

describe('apertura de saldos iniciales (importador F1)', () => {
  it('rechaza balanza descuadrada y diferencias contra las cuentas de enlace', async () => {
    const descuadrada = await request(app).post('/api/apertura/validar').send({
      fecha: '2026-07-25',
      balanza: [
        { cuenta: '1-01-01', debito: 100, credito: 0 },
        { cuenta: '4-01', debito: 0, credito: 99.99 },
      ],
    });
    expect(descuadrada.status).toBe(200);
    expect(descuadrada.body.valida).toBe(false);
    expect(descuadrada.body.errores.join(' ')).toMatch(/NO cuadra/);

    const carteraMal = await request(app).post('/api/apertura/validar').send({
      fecha: '2026-07-25',
      balanza: [
        { cuenta: '1-01-01', debito: 100, credito: 0 },
        { cuenta: '1-01-03', debito: 50, credito: 0 },
        { cuenta: '3-02', debito: 0, credito: 150 },
      ],
      clientes: [{ nombre: 'Cliente Prueba', saldo: 40 }],
    });
    expect(carteraMal.body.valida).toBe(false);
    expect(carteraMal.body.errores.join(' ')).toMatch(/IGUALES al centavo/);
  }, 60_000);

  it('carga la apertura completa: asiento + cartera + proveedores + inventario', async () => {
    const antes = await pool.query(
      `SELECT COALESCE(cantidad, 0) AS c FROM existencias WHERE producto_id = 1 AND bodega = 'BOD-CEN'`
    );
    ctx.existenciaAntesApertura = Number(antes.rows[0]?.c ?? 0);

    const paquete = {
      fecha: '2026-07-25',
      crear_terceros: true,
      balanza: [
        { cuenta: '1-01-01', debito: 10000, credito: 0 },
        { cuenta: '1-01-03', debito: 5000, credito: 0 },
        { cuenta: '1-01-04', debito: 250, credito: 0 },
        { cuenta: '2-01', debito: 0, credito: 3000 },
        { cuenta: '3-02', debito: 0, credito: 12250 },
      ],
      clientes: [{ ruc: 'AP001', nombre: 'Cliente Apertura', saldo: 5000 }],
      proveedores: [{ nombre: 'Proveedor Prueba', saldo: 3000 }],
      inventario: [{ producto: 'PR-1', bodega: 'BOD-CEN', cantidad: 20, costo_unitario: 12.5 }],
    };
    const valida = await request(app).post('/api/apertura/validar').send(paquete);
    expect(valida.body.errores).toEqual([]);
    expect(valida.body.valida).toBe(true);

    const carga = await request(app).post('/api/apertura/cargar').send(paquete);
    if (carga.status !== 201) throw new Error(`Carga falló: ${JSON.stringify(carga.body)}`);
    ctx.aperturaAsiento = carga.body.asiento_id;

    // asiento vivo y cuadrado por el trigger (si no, el COMMIT habría fallado)
    const estado = await request(app).get('/api/apertura');
    expect(estado.body.cargada).toBe(true);
    expect(Number(estado.body.apertura.id)).toBe(Number(ctx.aperturaAsiento));

    // cartera: factura INI-000001 emitida, con el saldo del cliente nuevo
    const factura = await pool.query(
      `SELECT f.total, f.estado, t.nombre FROM facturas f JOIN terceros t ON t.id = f.tercero_id
       WHERE f.origen = 'apertura' AND f.numero_completo = 'INI-000001'`
    );
    expect(factura.rowCount).toBe(1);
    expect(Number(factura.rows[0].total)).toBe(5000);
    expect(factura.rows[0].nombre).toBe('Cliente Apertura');

    // proveedores: compra INI registrada, pagable
    const compra = await pool.query(
      `SELECT total FROM compras WHERE numero_documento LIKE 'INI-%' AND estado = 'registrada'`
    );
    expect(compra.rowCount).toBe(1);
    expect(Number(compra.rows[0].total)).toBe(3000);

    // inventario: existencia subió 20 en BOD-CEN
    const despues = await pool.query(
      `SELECT cantidad FROM existencias WHERE producto_id = 1 AND bodega = 'BOD-CEN'`
    );
    expect(Number(despues.rows[0].cantidad)).toBe(ctx.existenciaAntesApertura + 20);

    // segunda apertura: bloqueada
    const otra = await request(app).post('/api/apertura/cargar').send(paquete);
    expect(otra.status).toBe(400);
    expect(JSON.stringify(otra.body)).toMatch(/Ya hay una apertura/);
  }, 120_000);

  it('anular la apertura revierte asiento, cartera, proveedores e inventario', async () => {
    const r = await request(app).post('/api/apertura/anular').send({ motivo: 'prueba de reversa' });
    if (r.status !== 200) throw new Error(`Anular falló: ${JSON.stringify(r.body)}`);

    const asiento = await pool.query('SELECT anulado FROM asientos WHERE id = $1', [ctx.aperturaAsiento]);
    expect(asiento.rows[0].anulado).toBe(true);
    const facturas = await pool.query(`SELECT count(*)::int AS n FROM facturas WHERE origen = 'apertura' AND estado = 'emitida'`);
    expect(Number(facturas.rows[0].n)).toBe(0);
    const compras = await pool.query(`SELECT count(*)::int AS n FROM compras WHERE numero_documento LIKE 'INI-%' AND estado = 'registrada'`);
    expect(Number(compras.rows[0].n)).toBe(0);
    const existencia = await pool.query(
      `SELECT COALESCE(cantidad, 0) AS c FROM existencias WHERE producto_id = 1 AND bodega = 'BOD-CEN'`
    );
    expect(Number(existencia.rows[0].c)).toBe(ctx.existenciaAntesApertura);

    const estado = await request(app).get('/api/apertura');
    expect(estado.body.cargada).toBe(false);
  }, 60_000);

  it('limpiar datos de prueba: exige la frase, borra transacciones y conserva catálogos y bitácora', async () => {
    const sinFrase = await request(app).post('/api/apertura/limpiar').send({ confirmacion: 'borrar' });
    expect(sinFrase.status).toBe(400);

    const r = await request(app).post('/api/apertura/limpiar').send({ confirmacion: 'LIMPIAR PRUEBAS' });
    expect(r.status).toBe(200);
    expect(r.body.borrado.asientos).toBeGreaterThan(0);

    const conteos = await pool.query(`
      SELECT (SELECT count(*)::int FROM asientos) AS asientos,
             (SELECT count(*)::int FROM facturas) AS facturas,
             (SELECT count(*)::int FROM movimientos_inventario) AS kardex,
             (SELECT count(*)::int FROM existencias) AS existencias,
             (SELECT count(*)::int FROM cuentas) AS cuentas,
             (SELECT count(*)::int FROM terceros) AS terceros,
             (SELECT count(*)::int FROM productos) AS productos,
             (SELECT max(ultimo_numero) FROM series) AS max_numero,
             (SELECT count(*)::int FROM bitacora WHERE accion = 'limpiar_datos') AS limpiezas`);
    const c = conteos.rows[0];
    expect(Number(c.asientos)).toBe(0);
    expect(Number(c.facturas)).toBe(0);
    expect(Number(c.kardex)).toBe(0);
    expect(Number(c.existencias)).toBe(0);
    expect(Number(c.cuentas)).toBeGreaterThan(0);   // catálogo contable intacto
    expect(Number(c.terceros)).toBeGreaterThan(0);  // catálogo comercial intacto (sin el checkbox)
    expect(Number(c.productos)).toBeGreaterThan(0);
    expect(Number(c.max_numero)).toBe(0);           // consecutivos reiniciados
    expect(Number(c.limpiezas)).toBe(1);            // la limpieza misma quedó en bitácora

    // y sobre la base limpia, la apertura carga sin estorbos
    const carga = await request(app).post('/api/apertura/cargar').send({
      fecha: '2026-07-25',
      balanza: [
        { cuenta: '1-01-01', debito: 500, credito: 0 },
        { cuenta: '3-02', debito: 0, credito: 500 },
      ],
    });
    expect(carga.status).toBe(201);
  }, 120_000);
});

describe('convertidor de la balanza detallada del sistema viejo', () => {
  it('separa clientes/proveedores/inventario, crea el catálogo y cuadra con ajuste', async () => {
    const r = await request(app).post('/api/apertura/convertir-detalle').send({
      filas: [
        { grupo: '1 1 1', grupo_nombre: 'CAJAS', codigo: '1 1 1 01', nombre: 'CAJA CENTRAL', final: 1000 },
        { grupo: '1 1 4', grupo_nombre: 'CUENTAS X COBRAR', codigo: '1 1 4 2 1', nombre: 'CLIENTE VIEJO UNO', final: 500 },
        { grupo: '1 1 4', grupo_nombre: 'CUENTAS X COBRAR', codigo: '1 1 4 2 2', nombre: 'RESIDUO CARTERA', final: -0.01 },
        { grupo: '1 1 3', grupo_nombre: 'INVENTARIOS', codigo: '1 1 3 01 5', nombre: 'PRODUCTO VIEJO X', final: 250 },
        { grupo: '2 1 1', grupo_nombre: 'OBL. CTO. PZO.', codigo: '2 1 1 1 2 2', nombre: 'INTCOMEX', final: -800 },
        { grupo: '2 1 1', grupo_nombre: 'OBL. CTO. PZO.', codigo: '2 1 1 4 58', nombre: 'INSS LABORAL', final: -100 },
        { grupo: '3  09', grupo_nombre: 'CAPITAL CONTABLE', codigo: '3  09 01 1', nombre: 'CAPITAL SOCIAL', final: -849.99 },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.clientes).toEqual([{ nombre: 'CLIENTE VIEJO UNO', saldo: 500 }]);
    expect(r.body.proveedores).toEqual([{ nombre: 'INTCOMEX', saldo: 800 }]);
    expect(r.body.totales.inventario).toBe(250);

    const porCuenta = new Map(
      (r.body.balanza as Array<{ cuenta: string; debito: number; credito: number }>).map((b) => [b.cuenta, b])
    );
    expect(porCuenta.get('1-1-4')?.debito).toBe(500);      // enlace CxC = cartera exacta
    expect(porCuenta.get('2-1-1-1')?.credito).toBe(800);   // enlace CxP = proveedores exactos
    expect(porCuenta.get('1-1-3')?.debito).toBe(250);      // inventario global
    expect(porCuenta.get('1-1-1-01')?.debito).toBe(1000);
    expect(porCuenta.get('2-1-1-4-58')?.credito).toBe(100);
    expect(porCuenta.get('3-99')?.credito).toBe(0.01);     // residuo descartado absorbido

    // la balanza convertida cuadra al centavo
    const filas = r.body.balanza as Array<{ debito: number; credito: number }>;
    const deb = filas.reduce((t, b) => t + Math.round(b.debito * 100), 0);
    const cre = filas.reduce((t, b) => t + Math.round(b.credito * 100), 0);
    expect(deb).toBe(cre);

    // catálogo creado con el código viejo en guiones y config apuntando a los enlaces
    const cuenta = await pool.query(`SELECT tipo, es_detalle FROM cuentas WHERE codigo = '2-1-1-4-58'`);
    expect(cuenta.rows[0]).toEqual({ tipo: 'pasivo', es_detalle: true });
    const cfg = await pool.query(`SELECT valor FROM config WHERE clave = 'cuenta_cxc'`);
    expect(cfg.rows[0].valor).toBe('1-1-4');
  }, 60_000);
});

describe('convertidor del reporte de existencias', () => {
  it('crea productos, arma la hoja de kardex y descarta cantidades microscópicas', async () => {
    const r = await request(app).post('/api/apertura/convertir-existencias').send({
      crear_productos: true,
      filas: [
        { codigo: 'IMP-1', nombre: 'MONITOR IMPORTADO 24', categoria: 'MONITORES', costo: 2612.2933,
          precio: 4500.5, existencias: [{ bodega: 'BOD-CEN', cantidad: 3 }, { bodega: 'BOD-SUR', cantidad: 2 }] },
        { codigo: 'IMP-2', nombre: 'RESIDUO DEL SISTEMA VIEJO', costo: 100,
          existencias: [{ bodega: 'BOD-CEN', cantidad: 0.000001 }] },
        { codigo: 'IMP-3', nombre: 'SIN STOCK PERO AL CATALOGO', costo: 50, existencias: [] },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.lineas).toBe(2);                       // IMP-1 en dos bodegas; el residuo fuera
    expect(r.body.productos_creados).toBe(3);            // el catálogo entra completo, con o sin stock
    expect(r.body.total).toBeCloseTo(2612.29 * 5, 2);    // 3 + 2 unidades al costo en centavos

    const p = await pool.query(`SELECT nombre, categoria, precio_venta FROM productos WHERE codigo = 'IMP-1'`);
    expect(p.rows[0].nombre).toBe('MONITOR IMPORTADO 24');
    expect(p.rows[0].categoria).toBe('MONITORES');
    expect(Number(p.rows[0].precio_venta)).toBe(4500.5);

    const bodegaMala = await request(app).post('/api/apertura/convertir-existencias').send({
      filas: [{ codigo: 'IMP-9', nombre: 'X', costo: 10, existencias: [{ bodega: 'NO-EXISTE', cantidad: 1 }] }],
    });
    expect(bodegaMala.status).toBe(400);
  }, 60_000);
});

describe('varios vendedores facturando A LA VEZ', () => {
  it('20 emisiones simultáneas: sin duplicados, sin huecos, existencia exacta y asientos cuadrados', async () => {
    // Fixture propio: no depende del estado que dejaron las pruebas anteriores
    await pool.query(
      `INSERT INTO productos (codigo, nombre, unidad, precio_venta)
       VALUES ('CONC-1', 'Producto concurrencia', 'unidad', 100) ON CONFLICT (codigo) DO NOTHING`
    );
    const prod = await pool.query(`SELECT id FROM productos WHERE codigo = 'CONC-1'`);
    const productoId = Number(prod.rows[0].id);
    await pool.query(
      `INSERT INTO series (serie, sucursal, tipo, prefijo, documento)
       VALUES ('CONC', 'CEN', 'sistema', 'CONC-', 'factura') ON CONFLICT (serie) DO NOTHING`
    );
    await pool.query(`UPDATE series SET ultimo_numero = 0 WHERE serie = 'CONC'`);

    // Mercadería para vender: 500 unidades en la bodega
    const compra = await request(app).post('/api/compras').send({
      tercero_id: 2, numero_documento: 'FC-CONC', fecha: '2026-07-25', tipo_pago: 'credito',
      bodega: 'BOD-CEN', lineas: [{ producto_id: productoId, cantidad: 500, costo_unitario: 50 }],
    });
    const registrada = await request(app).post(`/api/compras/${compra.body.id}/registrar`).send({});
    expect(registrada.status).toBe(200);

    const antes = await pool.query(
      `SELECT cantidad FROM existencias WHERE producto_id = $1 AND bodega = 'BOD-CEN'`, [productoId]
    );
    const stockAntes = Number(antes.rows[0].cantidad);

    const VENDEDORES = 20;
    const POR_FACTURA = 2;

    // Cada vendedor arma su borrador y lo emite — todos al mismo tiempo
    const emisiones = await Promise.all(
      Array.from({ length: VENDEDORES }, async (_, i) => {
        const borrador = await request(app).post('/api/facturas').send({
          serie: 'CONC', fecha: '2026-07-25', tercero_id: 1, tipo_pago: 'contado', bodega: 'BOD-CEN',
          lineas: [{ producto_id: productoId, descripcion: `Venta ${i + 1}`, cantidad: POR_FACTURA, precio_unitario: 100 }],
        });
        expect(borrador.status).toBe(201);
        return request(app).post(`/api/facturas/${borrador.body.id}/emitir`).send({});
      })
    );

    const fallidas = emisiones.filter((r) => r.status !== 200);
    expect(fallidas.map((r) => r.body), 'ninguna emisión debe fallar').toEqual([]);

    // El consecutivo es sagrado: ni un número repetido ni un hueco
    const numeros = emisiones.map((r) => Number(r.body.numero)).sort((a, b) => a - b);
    expect(new Set(numeros).size, 'números duplicados').toBe(VENDEDORES);
    expect(numeros).toEqual(Array.from({ length: VENDEDORES }, (_, i) => i + 1));

    // El inventario descontó EXACTO (nadie piso a nadie en el kardex)
    const despues = await pool.query(
      `SELECT cantidad FROM existencias WHERE producto_id = $1 AND bodega = 'BOD-CEN'`, [productoId]
    );
    expect(Number(despues.rows[0].cantidad)).toBe(stockAntes - VENDEDORES * POR_FACTURA);

    // Y cada factura dejó su asiento cuadrado
    const cuadre = await pool.query(`
      SELECT a.id, SUM(m.debito) AS debitos, SUM(m.credito) AS creditos
      FROM facturas f
      JOIN asientos a ON a.id = f.asiento_id
      JOIN movimientos m ON m.asiento_id = a.id
      WHERE f.serie = 'CONC' GROUP BY a.id`);
    expect(cuadre.rowCount).toBe(VENDEDORES);
    for (const r of cuadre.rows) {
      expect(Number(r.debitos)).toBeCloseTo(Number(r.creditos), 2);
    }
  }, 180_000);
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
