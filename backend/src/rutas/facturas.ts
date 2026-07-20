import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool, enTransaccion } from '../db';
import { envolver, aCentavos } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';
import { leerConfig } from '../config';
import { salidaInventario, revertirSalida } from '../inventario';

export const rutasFacturas = Router();

interface LineaEntrada {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  producto_id?: number | null;
}

interface TotalesFactura {
  lineas: Array<LineaEntrada & { total: number }>;
  subtotal: number;
  iva: number;
  total: number;
}

/** Calcula totales en centavos enteros; devuelve null si alguna línea es inválida. */
function calcularTotales(lineas: unknown, tasaIva: number): TotalesFactura | null {
  if (!Array.isArray(lineas) || lineas.length === 0) return null;
  const limpias: Array<LineaEntrada & { total: number }> = [];
  let subtotalCent = 0;
  for (const l of lineas as LineaEntrada[]) {
    const cantidad = Number(l.cantidad);
    const precio = Number(l.precio_unitario);
    if (!l.descripcion || !Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(precio) || precio < 0) {
      return null;
    }
    const totalCent = Math.round(cantidad * aCentavos(precio));
    subtotalCent += totalCent;
    limpias.push({
      descripcion: l.descripcion,
      cantidad,
      precio_unitario: precio,
      producto_id: l.producto_id ?? null,
      total: totalCent / 100,
    });
  }
  const ivaCent = Math.round(subtotalCent * tasaIva);
  return {
    lineas: limpias,
    subtotal: subtotalCent / 100,
    iva: ivaCent / 100,
    total: (subtotalCent + ivaCent) / 100,
  };
}

async function periodoAbierto(anoMes: string): Promise<string | null> {
  const p = await pool.query('SELECT estado FROM periodos WHERE ano_mes = $1', [anoMes]);
  if (p.rowCount === 0) return `El período ${anoMes} no existe — abrilo primero en Períodos`;
  if (p.rows[0].estado !== 'abierto') return `El período ${anoMes} está cerrado`;
  return null;
}

const SQL_LISTA = `
  SELECT f.*, t.nombre AS cliente,
         COALESCE(su.nombre, s.tienda) AS tienda,
         v.nombre AS vendedor
  FROM facturas f
  LEFT JOIN terceros t ON t.id = f.tercero_id
  JOIN series s   ON s.serie = f.serie
  LEFT JOIN sucursales su ON su.codigo = s.sucursal
  LEFT JOIN vendedores v  ON v.id = f.vendedor_id`;

rutasFacturas.get('/', requierePermiso('facturacion', 'ver'), envolver(async (req, res) => {
  const estado = typeof req.query.estado === 'string' && ['borrador', 'emitida', 'anulada'].includes(req.query.estado)
    ? req.query.estado
    : null;
  const r = await pool.query(
    `${SQL_LISTA}
     WHERE $1::text IS NULL OR f.estado = $1
     ORDER BY f.id DESC LIMIT 300`,
    [estado]
  );
  res.json(r.rows);
}));

rutasFacturas.get('/:id', requierePermiso('facturacion', 'ver'), envolver(async (req, res) => {
  const r = await pool.query(`${SQL_LISTA} WHERE f.id = $1`, [req.params.id]);
  if (r.rowCount === 0) {
    res.status(404).json({ error: 'Factura no existe' });
    return;
  }
  const lineas = await pool.query('SELECT * FROM factura_lineas WHERE factura_id = $1 ORDER BY id', [req.params.id]);
  res.json({ ...r.rows[0], lineas: lineas.rows });
}));

// Crear BORRADOR (sin número — el número se asigna solo al emitir)
rutasFacturas.post('/', requierePermiso('facturacion', 'crear'), envolver(async (req, res) => {
  const { serie, fecha, tercero_id, tipo_pago, lineas, notas, vendedor_id } = req.body ?? {};
  if (!serie || !tercero_id || !['contado', 'credito'].includes(tipo_pago)) {
    res.status(400).json({ error: 'serie, tercero_id y tipo_pago (contado/credito) son obligatorios' });
    return;
  }
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    res.status(400).json({ error: 'fecha inválida (YYYY-MM-DD)' });
    return;
  }
  const cfg = await leerConfig(pool, ['tasa_iva']);
  const totales = calcularTotales(lineas, Number(cfg.tasa_iva));
  if (!totales) {
    res.status(400).json({ error: 'Líneas inválidas: descripción, cantidad > 0 y precio >= 0' });
    return;
  }
  const factura = await enTransaccion(async (bd: PoolClient) => {
    const f = await bd.query(
      `INSERT INTO facturas (serie, fecha, tercero_id, tipo_pago, subtotal, iva, total, notas, vendedor_id, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [serie, fecha, tercero_id, tipo_pago, totales.subtotal, totales.iva, totales.total,
       notas || null, vendedor_id || null, req.usuario!.id]
    );
    for (const l of totales.lineas) {
      await bd.query(
        `INSERT INTO factura_lineas (factura_id, descripcion, cantidad, precio_unitario, total, producto_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [f.rows[0].id, l.descripcion, l.cantidad, l.precio_unitario, l.total, l.producto_id]
      );
    }
    return f.rows[0];
  });
  res.status(201).json(factura);
}));

// Editar BORRADOR (reemplaza encabezado y líneas; la BD bloquea si no es borrador)
rutasFacturas.put('/:id', requierePermiso('facturacion', 'editar'), envolver(async (req, res) => {
  const { serie, fecha, tercero_id, tipo_pago, lineas, notas, vendedor_id } = req.body ?? {};
  const actual = await pool.query('SELECT estado FROM facturas WHERE id = $1', [req.params.id]);
  if (actual.rowCount === 0) {
    res.status(404).json({ error: 'Factura no existe' });
    return;
  }
  if (actual.rows[0].estado !== 'borrador') {
    res.status(409).json({ error: 'Solo los borradores se editan; una emitida se anula' });
    return;
  }
  const cfg = await leerConfig(pool, ['tasa_iva']);
  const totales = calcularTotales(lineas, Number(cfg.tasa_iva));
  if (!totales) {
    res.status(400).json({ error: 'Líneas inválidas: descripción, cantidad > 0 y precio >= 0' });
    return;
  }
  const factura = await enTransaccion(async (bd: PoolClient) => {
    const f = await bd.query(
      `UPDATE facturas
       SET serie = $2, fecha = $3, tercero_id = $4, tipo_pago = $5,
           subtotal = $6, iva = $7, total = $8, notas = $9, vendedor_id = $10,
           actualizado_por = $11, actualizado_en = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, serie, fecha, tercero_id, tipo_pago,
       totales.subtotal, totales.iva, totales.total, notas || null, vendedor_id || null, req.usuario!.id]
    );
    await bd.query('DELETE FROM factura_lineas WHERE factura_id = $1', [req.params.id]);
    for (const l of totales.lineas) {
      await bd.query(
        `INSERT INTO factura_lineas (factura_id, descripcion, cantidad, precio_unitario, total, producto_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.params.id, l.descripcion, l.cantidad, l.precio_unitario, l.total, l.producto_id]
      );
    }
    return f.rows[0];
  });
  res.json(factura);
}));

rutasFacturas.delete('/:id', requierePermiso('facturacion', 'editar'), envolver(async (req, res) => {
  const r = await pool.query(`DELETE FROM facturas WHERE id = $1 AND estado = 'borrador' RETURNING id`, [req.params.id]);
  if (r.rowCount === 0) {
    res.status(409).json({ error: 'Solo los borradores se pueden descartar' });
    return;
  }
  res.json({ ok: true });
}));

// EMITIR: número con row-lock sobre la serie + asiento automático,
// todo en UNA transacción (si algo falla, no se quema el número)
rutasFacturas.post('/:id/emitir', requierePermiso('facturacion', 'crear'), envolver(async (req, res) => {
  const id = Number(req.params.id);
  const numeroManual = Number((req.body ?? {}).numero_manual ?? 0);

  const previa = await pool.query('SELECT fecha FROM facturas WHERE id = $1', [id]);
  if (previa.rowCount === 0) {
    res.status(404).json({ error: 'Factura no existe' });
    return;
  }
  const fechaFactura: string = previa.rows[0].fecha.toISOString().slice(0, 10);
  const errorPeriodo = await periodoAbierto(fechaFactura.slice(0, 7));
  if (errorPeriodo) {
    res.status(400).json({ error: errorPeriodo });
    return;
  }

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; factura?: unknown }> => {
    const f = await bd.query('SELECT * FROM facturas WHERE id = $1 FOR UPDATE', [id]);
    const factura = f.rows[0];
    if (factura.estado !== 'borrador') return { error: 409, mensaje: 'La factura ya fue emitida o anulada' };

    const nLineas = await bd.query('SELECT count(*)::int AS n FROM factura_lineas WHERE factura_id = $1', [id]);
    if ((nLineas.rows[0]?.n ?? 0) === 0) return { error: 400, mensaje: 'La factura no tiene líneas' };

    // Bodega de la sucursal (para descargar inventario) — se valida ANTES de escribir nada
    const lineasProducto = await bd.query(
      'SELECT producto_id, cantidad FROM factura_lineas WHERE factura_id = $1 AND producto_id IS NOT NULL',
      [id]
    );
    let bodega: string | null = null;
    if ((lineasProducto.rowCount ?? 0) > 0) {
      const b = await bd.query(
        `SELECT b.codigo FROM bodegas b JOIN series s ON s.sucursal = b.sucursal
         WHERE s.serie = $1 AND b.activa ORDER BY b.codigo LIMIT 1`,
        [factura.serie]
      );
      if (b.rowCount === 0) {
        return {
          error: 400,
          mensaje: `La sucursal de la serie ${factura.serie} no tiene bodega activa — creala en Configuración → Bodegas`,
        };
      }
      bodega = b.rows[0].codigo;
    }

    const cliente = await bd.query('SELECT nombre FROM terceros WHERE id = $1', [factura.tercero_id]);

    // Consecutivo con row-lock sobre la serie (plan §F2)
    const s = await bd.query(
      'SELECT tipo, prefijo, ultimo_numero, activa, numero_desde, sucursal FROM series WHERE serie = $1 FOR UPDATE',
      [factura.serie]
    );
    if (s.rowCount === 0 || !s.rows[0].activa) {
      return { error: 409, mensaje: `La serie ${factura.serie} no existe o está inactiva` };
    }

    // Amarre por tienda: el vendedor debe pertenecer a la sucursal de la serie
    // (vendedor sin sucursal asignada = comodín, puede facturar en cualquiera)
    if (factura.vendedor_id && s.rows[0].sucursal) {
      const vend = await bd.query('SELECT nombre, sucursal FROM vendedores WHERE id = $1', [factura.vendedor_id]);
      const sucursalVendedor = vend.rows[0]?.sucursal;
      if (sucursalVendedor && sucursalVendedor !== s.rows[0].sucursal) {
        return {
          error: 400,
          mensaje: `${vend.rows[0].nombre} pertenece a la sucursal ${sucursalVendedor} — no puede facturar en la serie ${factura.serie}`,
        };
      }
    }

    const esManual = s.rows[0].tipo === 'manual';
    let numero: number;
    if (esManual) {
      // Factura de PAPEL: el número lo trae el talonario, se digita
      if (!Number.isInteger(numeroManual) || numeroManual <= 0) {
        return { error: 400, mensaje: `La serie ${factura.serie} es manual: indicá el número de la factura de papel` };
      }
      const desde = Number(s.rows[0].numero_desde ?? 1);
      if (numeroManual < desde) {
        return { error: 400, mensaje: `El talonario de la serie ${factura.serie} empieza en el Nº ${desde}` };
      }
      const usado = await bd.query('SELECT 1 FROM facturas WHERE serie = $1 AND numero = $2', [
        factura.serie, numeroManual,
      ]);
      if ((usado.rowCount ?? 0) > 0) {
        return { error: 409, mensaje: `El número ${numeroManual} de la serie ${factura.serie} ya fue grabado` };
      }
      numero = numeroManual;
      await bd.query('UPDATE series SET ultimo_numero = GREATEST(ultimo_numero, $2) WHERE serie = $1', [
        factura.serie, numero,
      ]);
    } else {
      numero = Number(s.rows[0].ultimo_numero) + 1;
      await bd.query('UPDATE series SET ultimo_numero = $2 WHERE serie = $1', [factura.serie, numero]);
    }
    const numeroCompleto = `${s.rows[0].prefijo}${String(numero).padStart(6, '0')}`;

    const cfg = await leerConfig(bd, [
      'cuenta_caja', 'cuenta_cxc', 'cuenta_ventas', 'cuenta_iva',
      'cuenta_costo_ventas', 'cuenta_inventario',
    ]);

    const asiento = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por)
       VALUES ($1, $2, 'factura', $3, $4, $5) RETURNING id`,
      [fechaFactura, fechaFactura.slice(0, 7), id,
       `Factura ${numeroCompleto} — ${cliente.rows[0]?.nombre ?? ''} (${factura.tipo_pago})`,
       req.usuario!.id]
    );
    const asientoId = asiento.rows[0].id;
    // Contado: la plata cae en la CAJA DE LA TIENDA (sucursal de la serie);
    // si la sucursal no tiene cuenta de caja asignada, va a la caja general
    let cuentaCaja = cfg.cuenta_caja;
    if (factura.tipo_pago === 'contado' && s.rows[0].sucursal) {
      const suc = await bd.query('SELECT cuenta_caja FROM sucursales WHERE codigo = $1', [s.rows[0].sucursal]);
      if (suc.rows[0]?.cuenta_caja) cuentaCaja = suc.rows[0].cuenta_caja;
    }
    const cuentaCargo = factura.tipo_pago === 'contado' ? cuentaCaja : cfg.cuenta_cxc;
    await bd.query(
      `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, tercero_id, documento_ref)
       VALUES ($1, $2, $3, 0, $4, $5)`,
      [asientoId, cuentaCargo, factura.total,
       factura.tipo_pago === 'credito' ? factura.tercero_id : null, numeroCompleto]
    );
    await bd.query(
      `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref)
       VALUES ($1, $2, 0, $3, $4)`,
      [asientoId, cfg.cuenta_ventas, factura.subtotal, numeroCompleto]
    );
    if (Number(factura.iva) > 0) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref)
         VALUES ($1, $2, 0, $3, $4)`,
        [asientoId, cfg.cuenta_iva, factura.iva, numeroCompleto]
      );
    }

    // Costo de venta + descarga de inventario (mismo asiento: la anulación revierte todo junto)
    if (bodega) {
      let costoCent = 0;
      for (const l of lineasProducto.rows) {
        const costoUnitario = await salidaInventario(bd, {
          fecha: fechaFactura,
          productoId: l.producto_id,
          bodega,
          cantidad: Number(l.cantidad),
          usuarioId: req.usuario!.id,
          origenTipo: 'factura',
          origenId: id,
        });
        costoCent += Math.round(Number(l.cantidad) * costoUnitario * 100);
      }
      if (costoCent > 0) {
        const costoTotal = costoCent / 100;
        await bd.query(
          `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref)
           VALUES ($1, $2, $3, 0, $4)`,
          [asientoId, cfg.cuenta_costo_ventas, costoTotal, numeroCompleto]
        );
        await bd.query(
          `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, documento_ref)
           VALUES ($1, $2, 0, $3, $4)`,
          [asientoId, cfg.cuenta_inventario, costoTotal, numeroCompleto]
        );
      }
    }

    const emitida = await bd.query(
      `UPDATE facturas
       SET numero = $2, numero_completo = $3, estado = 'emitida', asiento_id = $4,
           origen = $5, emitida_en = now(), actualizado_por = $6, actualizado_en = now()
       WHERE id = $1 RETURNING *`,
      [id, numero, numeroCompleto, asientoId, esManual ? 'manual' : 'sistema', req.usuario!.id]
    );
    await registrarBitacora(bd, req.usuario!.id, 'emitir_factura', 'facturas', String(id), {
      numero: numeroCompleto,
      total: factura.total,
      tipo_pago: factura.tipo_pago,
    });
    return { factura: emitida.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.json(resultado.factura);
}));

// Grabar una factura de PAPEL DAÑADA como anulada (sin cliente ni montos):
// el consecutivo queda completo ante la DGI sin tocar la contabilidad
rutasFacturas.post('/manual-anulada', requierePermiso('facturacion', 'crear'), envolver(async (req, res) => {
  const { serie, numero, motivo } = req.body ?? {};
  const n = Number(numero);
  if (!serie || !Number.isInteger(n) || n <= 0 || !motivo) {
    res.status(400).json({ error: 'serie, numero y motivo son obligatorios' });
    return;
  }
  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; factura?: unknown }> => {
    const s = await bd.query(`SELECT tipo, prefijo FROM series WHERE serie = $1 FOR UPDATE`, [serie]);
    if (s.rowCount === 0 || s.rows[0].tipo !== 'manual') {
      return { error: 400, mensaje: `${serie} no es una serie manual` };
    }
    const usado = await bd.query('SELECT 1 FROM facturas WHERE serie = $1 AND numero = $2', [serie, n]);
    if ((usado.rowCount ?? 0) > 0) return { error: 409, mensaje: `El número ${n} ya fue grabado en ${serie}` };
    const numeroCompleto = `${s.rows[0].prefijo}${String(n).padStart(6, '0')}`;
    const hoy = new Date().toISOString().slice(0, 10);
    const f = await bd.query(
      `INSERT INTO facturas (serie, numero, numero_completo, fecha, tipo_pago, estado, origen, notas, creado_por)
       VALUES ($1, $2, $3, $4, 'contado', 'anulada', 'manual', $5, $6) RETURNING *`,
      [serie, n, numeroCompleto, hoy, `Papel dañado/anulado: ${motivo}`, req.usuario!.id]
    );
    await bd.query('UPDATE series SET ultimo_numero = GREATEST(ultimo_numero, $2) WHERE serie = $1', [serie, n]);
    await registrarBitacora(bd, req.usuario!.id, 'grabar_manual_anulada', 'facturas', String(f.rows[0].id), {
      numero: numeroCompleto,
      motivo,
    });
    return { factura: f.rows[0] };
  });
  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.status(201).json(resultado.factura);
}));

// ANULAR: conserva el número (DGI exige consecutivo completo); contra-asiento hoy
rutasFacturas.post('/:id/anular', requierePermiso('facturacion', 'anular'), envolver(async (req, res) => {
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

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; factura?: unknown }> => {
    const f = await bd.query('SELECT * FROM facturas WHERE id = $1 FOR UPDATE', [id]);
    if (f.rowCount === 0) return { error: 404, mensaje: 'Factura no existe' };
    const factura = f.rows[0];
    if (factura.estado !== 'emitida') return { error: 409, mensaje: 'Solo se anulan facturas emitidas' };

    const movs = await bd.query('SELECT * FROM movimientos WHERE asiento_id = $1 ORDER BY id', [factura.asiento_id]);
    const contra = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por)
       VALUES ($1, $2, 'contra_asiento', $3, $4, $5) RETURNING id`,
      [hoy, hoy.slice(0, 7), id, `Anulación factura ${factura.numero_completo}: ${motivo}`, req.usuario!.id]
    );
    for (const m of movs.rows) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito, tercero_id, documento_ref)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [contra.rows[0].id, m.cuenta, m.credito, m.debito, m.tercero_id, m.documento_ref]
      );
    }
    await bd.query('UPDATE asientos SET anulado = true, anulado_por = $2 WHERE id = $1', [
      factura.asiento_id,
      contra.rows[0].id,
    ]);

    // Reingreso al inventario de lo que la factura descargó
    const salidas = await bd.query(
      `SELECT * FROM movimientos_inventario
       WHERE origen_tipo = 'factura' AND origen_id = $1 AND tipo = 'salida_venta'`,
      [id]
    );
    for (const k of salidas.rows) {
      await revertirSalida(
        bd,
        { fecha: hoy, productoId: k.producto_id, bodega: k.bodega, cantidad: Math.abs(Number(k.cantidad)),
          usuarioId: req.usuario!.id, origenTipo: 'factura', origenId: id },
        Number(k.costo_unitario)
      );
    }

    const anulada = await bd.query(
      `UPDATE facturas SET estado = 'anulada', actualizado_por = $2, actualizado_en = now()
       WHERE id = $1 RETURNING *`,
      [id, req.usuario!.id]
    );
    await registrarBitacora(bd, req.usuario!.id, 'anular_factura', 'facturas', String(id), {
      numero: factura.numero_completo,
      motivo,
      contra_asiento: contra.rows[0].id,
    });
    return { factura: anulada.rows[0] };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.json(resultado.factura);
}));
