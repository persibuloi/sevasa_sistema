import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool, enTransaccion } from '../db';
import { envolver, aCentavos } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';
import { leerConfig } from '../config';

/** F3 — Bancos: cuentas bancarias, cheques/transferencias/depósitos con
 *  asiento automático, pago a proveedores (baja CxP) y conciliación. */
export const rutasBancos = Router();

const TIPOS_SALIDA = ['cheque', 'transferencia', 'debito_bancario'];
const TIPOS_ENTRADA = ['deposito', 'credito_bancario'];

async function periodoAbierto(anoMes: string): Promise<string | null> {
  const p = await pool.query('SELECT estado FROM periodos WHERE ano_mes = $1', [anoMes]);
  if (p.rowCount === 0) return `El período ${anoMes} no existe — abrilo primero en Períodos`;
  if (p.rows[0].estado !== 'abierto') return `El período ${anoMes} está cerrado`;
  return null;
}

/* ------------------------------------------------------- cuentas bancarias */

rutasBancos.get('/cuentas', requierePermiso('bancos', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query(
    `SELECT cb.*, c.nombre AS cuenta_contable_nombre,
            COALESCE(m.saldo, 0) AS saldo_libro
     FROM cuentas_bancarias cb
     LEFT JOIN cuentas c ON c.codigo = cb.cuenta_contable
     LEFT JOIN (
       SELECT cuenta_bancaria_id,
              SUM(CASE WHEN tipo IN ('deposito','credito_bancario') THEN monto ELSE -monto END) AS saldo
       FROM movimientos_banco WHERE estado = 'emitido'
       GROUP BY cuenta_bancaria_id
     ) m ON m.cuenta_bancaria_id = cb.id
     ORDER BY cb.banco, cb.nombre`
  );
  res.json(r.rows);
}));

rutasBancos.post('/cuentas', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { banco, nombre, numero, moneda, cuenta_contable, ultimo_cheque } = req.body ?? {};
  if (!banco || !nombre || !numero || !cuenta_contable) {
    res.status(400).json({ error: 'banco, nombre, numero y cuenta_contable son obligatorios' });
    return;
  }
  const inicial = Number(ultimo_cheque ?? 0);
  if (!Number.isInteger(inicial) || inicial < 0) {
    res.status(400).json({ error: 'ultimo_cheque debe ser un entero >= 0' });
    return;
  }
  const r = await pool.query(
    `INSERT INTO cuentas_bancarias (banco, nombre, numero, moneda, cuenta_contable, ultimo_cheque, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [banco, nombre, numero, moneda === 'USD' ? 'USD' : 'NIO', cuenta_contable, inicial, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'crear_cuenta_bancaria', 'cuentas_bancarias', String(r.rows[0].id), r.rows[0]);
  res.status(201).json(r.rows[0]);
}));

rutasBancos.put('/cuentas/:id', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { banco, nombre, numero, cuenta_contable, ultimo_cheque, activa } = req.body ?? {};
  const antes = await pool.query('SELECT * FROM cuentas_bancarias WHERE id = $1', [req.params.id]);
  if (antes.rowCount === 0) {
    res.status(404).json({ error: 'Cuenta bancaria no existe' });
    return;
  }
  let nuevoUltimo = Number(antes.rows[0].ultimo_cheque);
  if (ultimo_cheque !== undefined && ultimo_cheque !== null && ultimo_cheque !== '') {
    const solicitado = Number(ultimo_cheque);
    if (!Number.isInteger(solicitado) || solicitado < 0) {
      res.status(400).json({ error: 'ultimo_cheque debe ser un entero >= 0' });
      return;
    }
    const usado = await pool.query(
      `SELECT COALESCE(MAX(numero), 0) AS maximo FROM movimientos_banco WHERE cuenta_bancaria_id = $1`,
      [req.params.id]
    );
    if (solicitado < Number(usado.rows[0].maximo)) {
      res.status(400).json({ error: `No se puede bajar de ${usado.rows[0].maximo}: ya hay cheques con ese número` });
      return;
    }
    nuevoUltimo = solicitado;
  }
  const r = await pool.query(
    `UPDATE cuentas_bancarias
     SET banco = $2, nombre = $3, numero = $4, cuenta_contable = $5, ultimo_cheque = $6, activa = $7,
         actualizado_por = $8, actualizado_en = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, banco ?? antes.rows[0].banco, nombre ?? antes.rows[0].nombre,
     numero ?? antes.rows[0].numero, cuenta_contable ?? antes.rows[0].cuenta_contable,
     nuevoUltimo, activa ?? antes.rows[0].activa, req.usuario!.id]
  );
  await registrarBitacora(pool, req.usuario!.id, 'editar_cuenta_bancaria', 'cuentas_bancarias', String(req.params.id), {
    antes: antes.rows[0],
    despues: r.rows[0],
  });
  res.json(r.rows[0]);
}));

/* -------------------------------------------------------------- CxP a pagar */

const SQL_SALDOS_CXP = `
  SELECT c.id, c.numero_documento, c.fecha, c.total, c.tercero_id,
         t.nombre AS proveedor, t.terminos_dias,
         COALESCE(p.pagado, 0) AS pagado,
         (c.total - COALESCE(p.pagado, 0)) AS saldo
  FROM compras c
  JOIN terceros t ON t.id = c.tercero_id
  LEFT JOIN (
    SELECT pa.compra_id, SUM(pa.monto) AS pagado
    FROM pago_aplicaciones pa
    JOIN movimientos_banco mb ON mb.id = pa.movimiento_banco_id AND mb.estado = 'emitido'
    GROUP BY pa.compra_id
  ) p ON p.compra_id = c.id
  WHERE c.estado = 'registrada' AND c.tipo_pago = 'credito'`;

rutasBancos.get('/cxp', requierePermiso('bancos', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query(`${SQL_SALDOS_CXP} ORDER BY t.nombre, c.fecha`);
  res.json(r.rows.filter((f) => Number(f.saldo) > 0.009));
}));

rutasBancos.get('/cxp/:terceroId', requierePermiso('bancos', 'ver'), envolver(async (req, res) => {
  const r = await pool.query(`${SQL_SALDOS_CXP} AND c.tercero_id = $1 ORDER BY c.fecha`, [req.params.terceroId]);
  res.json(r.rows.filter((f) => Number(f.saldo) > 0.009));
}));

/* --------------------------------------------------------------- movimientos */

rutasBancos.get('/movimientos', requierePermiso('bancos', 'ver'), envolver(async (req, res) => {
  const cuenta = typeof req.query.cuenta === 'string' && req.query.cuenta !== '' ? Number(req.query.cuenta) : null;
  const r = await pool.query(
    `SELECT mb.*, cb.nombre AS cuenta_nombre, cb.banco, t.nombre AS tercero_nombre
     FROM movimientos_banco mb
     JOIN cuentas_bancarias cb ON cb.id = mb.cuenta_bancaria_id
     LEFT JOIN terceros t ON t.id = mb.tercero_id
     WHERE $1::bigint IS NULL OR mb.cuenta_bancaria_id = $1
     ORDER BY mb.id DESC LIMIT 300`,
    [cuenta]
  );
  res.json(r.rows);
}));

rutasBancos.post('/movimientos', requierePermiso('bancos', 'crear'), envolver(async (req, res) => {
  const { cuenta_bancaria_id, tipo, fecha, beneficiario, tercero_id, concepto, monto, contrapartida, aplicaciones } =
    req.body ?? {};
  if (!cuenta_bancaria_id || ![...TIPOS_SALIDA, ...TIPOS_ENTRADA].includes(tipo) || !concepto) {
    res.status(400).json({ error: 'cuenta_bancaria_id, tipo válido y concepto son obligatorios' });
    return;
  }
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    res.status(400).json({ error: 'fecha inválida (YYYY-MM-DD)' });
    return;
  }
  const esSalida = TIPOS_SALIDA.includes(tipo);
  const esPagoProveedor = Array.isArray(aplicaciones) && aplicaciones.length > 0;
  if (esPagoProveedor && !esSalida) {
    res.status(400).json({ error: 'Solo cheques/transferencias/débitos pueden pagar a proveedores' });
    return;
  }
  if (esPagoProveedor && !tercero_id) {
    res.status(400).json({ error: 'El pago a proveedor necesita tercero_id' });
    return;
  }
  let montoCent = 0;
  if (esPagoProveedor) {
    for (const a of aplicaciones as Array<{ compra_id: number; monto: number }>) {
      const c = aCentavos(a.monto);
      if (!a.compra_id || Number.isNaN(c) || c <= 0) {
        res.status(400).json({ error: 'Cada aplicación necesita compra_id y monto > 0' });
        return;
      }
      montoCent += c;
    }
  } else {
    montoCent = aCentavos(monto);
    if (Number.isNaN(montoCent) || montoCent <= 0) {
      res.status(400).json({ error: 'monto debe ser mayor que cero' });
      return;
    }
    if (!contrapartida) {
      res.status(400).json({ error: 'Indicá la cuenta contable de contrapartida' });
      return;
    }
  }
  const errorPeriodo = await periodoAbierto(fecha.slice(0, 7));
  if (errorPeriodo) {
    res.status(400).json({ error: errorPeriodo });
    return;
  }

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; movimiento?: unknown }> => {
    const cb = await bd.query('SELECT * FROM cuentas_bancarias WHERE id = $1 FOR UPDATE', [cuenta_bancaria_id]);
    if (cb.rowCount === 0 || !cb.rows[0].activa) return { error: 400, mensaje: 'Cuenta bancaria inexistente o inactiva' };
    const banco = cb.rows[0];

    // Validar aplicaciones contra el saldo de cada compra (con lock)
    if (esPagoProveedor) {
      for (const a of aplicaciones as Array<{ compra_id: number; monto: number }>) {
        const compra = await bd.query(`${SQL_SALDOS_CXP} AND c.id = $1 FOR UPDATE OF c`, [a.compra_id]);
        if (compra.rowCount === 0) return { error: 400, mensaje: `La compra ${a.compra_id} no es de crédito registrada` };
        if (Number(compra.rows[0].tercero_id) !== Number(tercero_id)) {
          return { error: 400, mensaje: `La compra ${compra.rows[0].numero_documento} no es de este proveedor` };
        }
        if (aCentavos(a.monto) > Math.round(Number(compra.rows[0].saldo) * 100) + 1) {
          return {
            error: 400,
            mensaje: `A la compra ${compra.rows[0].numero_documento} solo se le deben ${Number(compra.rows[0].saldo).toFixed(2)}`,
          };
        }
      }
    }

    // Nº de cheque: consecutivo propio de la chequera, con la cuenta bloqueada
    let numeroCheque: number | null = null;
    if (tipo === 'cheque') {
      numeroCheque = Number(banco.ultimo_cheque) + 1;
      await bd.query('UPDATE cuentas_bancarias SET ultimo_cheque = $2 WHERE id = $1', [banco.id, numeroCheque]);
    }

    const cfg = await leerConfig(bd, ['cuenta_cxp']);
    const montoTotal = montoCent / 100;
    const referencia = tipo === 'cheque' ? `CK-${String(numeroCheque).padStart(6, '0')}` : concepto.slice(0, 30);
    const tipoOrigen = tipo === 'cheque' ? 'cheque' : tipo === 'transferencia' ? 'transferencia' : tipo === 'deposito' ? 'deposito' : 'banco';

    const asiento = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, concepto, creado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [fecha, fecha.slice(0, 7),
       tipoOrigen,
       `${tipo === 'cheque' ? `Cheque ${referencia}` : concepto} — ${banco.nombre}${beneficiario ? ` / ${beneficiario}` : ''}`,
       req.usuario!.id]
    );
    const asientoId = asiento.rows[0].id;

    if (esSalida) {
      const cuentaDebe = esPagoProveedor ? cfg.cuenta_cxp : contrapartida;
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, tercero_id, documento_ref)
         VALUES ($1, $2, $3, 0, $4, $5)`,
        [asientoId, cuentaDebe, montoTotal, esPagoProveedor ? tercero_id : null, referencia]
      );
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref)
         VALUES ($1, $2, 0, $3, $4)`,
        [asientoId, banco.cuenta_contable, montoTotal, referencia]
      );
    } else {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref)
         VALUES ($1, $2, $3, 0, $4)`,
        [asientoId, banco.cuenta_contable, montoTotal, referencia]
      );
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref)
         VALUES ($1, $2, 0, $3, $4)`,
        [asientoId, contrapartida, montoTotal, referencia]
      );
    }

    const movimiento = await bd.query(
      `INSERT INTO movimientos_banco
         (cuenta_bancaria_id, fecha, tipo, numero, beneficiario, tercero_id, concepto, monto, asiento_id, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [banco.id, fecha, tipo, numeroCheque, beneficiario || null, tercero_id || null,
       concepto, montoTotal, asientoId, req.usuario!.id]
    );
    if (esPagoProveedor) {
      for (const a of aplicaciones as Array<{ compra_id: number; monto: number }>) {
        await bd.query(
          `INSERT INTO pago_aplicaciones (movimiento_banco_id, compra_id, monto) VALUES ($1, $2, $3)`,
          [movimiento.rows[0].id, a.compra_id, Number(a.monto)]
        );
      }
    }
    await registrarBitacora(bd, req.usuario!.id, `emitir_${tipo}`, 'movimientos_banco', String(movimiento.rows[0].id), {
      cuenta: banco.nombre,
      monto: montoTotal,
      cheque: numeroCheque,
    });
    return { movimiento: movimiento.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.status(201).json(resultado.movimiento);
}));

rutasBancos.post('/movimientos/:id/anular', requierePermiso('bancos', 'anular'), envolver(async (req, res) => {
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

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; movimiento?: unknown }> => {
    const m = await bd.query('SELECT * FROM movimientos_banco WHERE id = $1 FOR UPDATE', [id]);
    if (m.rowCount === 0) return { error: 404, mensaje: 'Movimiento no existe' };
    if (m.rows[0].estado !== 'emitido') return { error: 409, mensaje: 'El movimiento ya está anulado' };

    const movs = await bd.query('SELECT * FROM movimientos WHERE asiento_id = $1 ORDER BY id', [m.rows[0].asiento_id]);
    const contra = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por)
       VALUES ($1, $2, 'contra_asiento', $3, $4, $5) RETURNING id`,
      [hoy, hoy.slice(0, 7), id,
       `Anulación ${m.rows[0].tipo}${m.rows[0].numero ? ` CK-${m.rows[0].numero}` : ''}: ${motivo}`,
       req.usuario!.id]
    );
    for (const mm of movs.rows) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, tercero_id, documento_ref)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [contra.rows[0].id, mm.cuenta, mm.credito, mm.debito, mm.tercero_id, mm.documento_ref]
      );
    }
    await bd.query('UPDATE asientos SET anulado = true, anulado_por = $2 WHERE id = $1', [
      m.rows[0].asiento_id,
      contra.rows[0].id,
    ]);
    const anulado = await bd.query(
      `UPDATE movimientos_banco SET estado = 'anulado', actualizado_por = $2, actualizado_en = now()
       WHERE id = $1 RETURNING *`,
      [id, req.usuario!.id]
    );
    await registrarBitacora(bd, req.usuario!.id, 'anular_movimiento_banco', 'movimientos_banco', String(id), { motivo });
    return { movimiento: anulado.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.json(resultado.movimiento);
}));

// Conciliación manual (importar estado de cuenta llega en F3b)
rutasBancos.put('/movimientos/:id/conciliar', requierePermiso('bancos', 'cerrar'), envolver(async (req, res) => {
  const { conciliado } = req.body ?? {};
  const r = await pool.query(
    `UPDATE movimientos_banco
     SET conciliado = $2, conciliado_en = CASE WHEN $2 THEN now() ELSE NULL END,
         actualizado_por = $3, actualizado_en = now()
     WHERE id = $1 AND estado = 'emitido' RETURNING *`,
    [req.params.id, conciliado === true, req.usuario!.id]
  );
  if (r.rowCount === 0) {
    res.status(409).json({ error: 'Movimiento inexistente o anulado' });
    return;
  }
  res.json(r.rows[0]);
}));
