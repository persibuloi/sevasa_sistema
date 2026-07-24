import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool, enTransaccion } from '../db';
import { envolver, aCentavos } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';
import { leerConfig } from '../config';
import { entradaInventario, revertirEntrada } from '../inventario';

/** Apertura de saldos iniciales (importador F1).
 *
 *  UN asiento tipo 'apertura' trae la balanza completa del sistema anterior
 *  (el trigger diferido exige cuadre al centavo). Los detalles van como
 *  AUXILIARES sin asiento propio, para no duplicar la contabilidad:
 *   - cartera:     una factura de apertura (serie INI) por cliente — los
 *                  recibos se le aplican hasta llegar a cero (decisión §F1)
 *   - proveedores: una compra de apertura por proveedor, pagable desde Bancos
 *   - inventario:  entrada de kardex por producto/bodega al costo cargado
 *                  (fija existencias y costo promedio)
 *  El portal valida que cada auxiliar sume EXACTO el saldo de su cuenta de
 *  enlace. Anular deshace todo en espejo. */
export const rutasApertura = Router();

interface FilaBalanza { cuenta: string; debito: number; credito: number }
interface FilaTercero { ruc?: string; nombre: string; saldo: number }
interface FilaInventario { producto: string; bodega: string; cantidad: number; costo_unitario: number }

interface CuerpoApertura {
  fecha?: string;
  balanza?: FilaBalanza[];
  clientes?: FilaTercero[];
  proveedores?: FilaTercero[];
  inventario?: FilaInventario[];
  crear_terceros?: boolean;
}

interface TerceroResuelto extends FilaTercero { tercero_id: number | null }
interface ProductoResuelto extends FilaInventario { producto_id: number }

interface Validacion {
  errores: string[];
  avisos: string[];
  totales: {
    debitos: number; creditos: number; diferencia: number;
    cartera: number; proveedores: number; inventario: number;
    saldo_cxc: number; saldo_cxp: number; saldo_inventario: number;
  };
  balanza: FilaBalanza[];
  clientes: TerceroResuelto[];
  proveedores: TerceroResuelto[];
  inventario: ProductoResuelto[];
}

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : NaN);

/** Valida todo el paquete SIN escribir. Deja los datos resueltos (ids). */
async function validarApertura(c: CuerpoApertura): Promise<Validacion> {
  const errores: string[] = [];
  const avisos: string[] = [];
  const balanza: FilaBalanza[] = [];
  const clientes: TerceroResuelto[] = [];
  const proveedores: TerceroResuelto[] = [];
  const inventario: ProductoResuelto[] = [];

  // --- fecha y período ---
  if (typeof c.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.fecha)) {
    errores.push('Fecha de corte inválida (YYYY-MM-DD)');
  } else {
    const p = await pool.query('SELECT estado FROM periodos WHERE ano_mes = $1', [c.fecha.slice(0, 7)]);
    if (p.rowCount === 0) errores.push(`El período ${c.fecha.slice(0, 7)} no existe — abrilo primero en Períodos`);
    else if (p.rows[0].estado !== 'abierto') errores.push(`El período ${c.fecha.slice(0, 7)} está cerrado`);
  }

  // --- apertura previa ---
  const previa = await pool.query(
    `SELECT id FROM asientos WHERE tipo_origen = 'apertura' AND NOT anulado LIMIT 1`
  );
  if ((previa.rowCount ?? 0) > 0) {
    errores.push(`Ya hay una apertura cargada (asiento #${previa.rows[0].id}) — anulala antes de cargar otra`);
  }

  // --- balanza ---
  const filas = Array.isArray(c.balanza) ? c.balanza : [];
  if (filas.length === 0) errores.push('La balanza está vacía');
  const vistas = new Set<string>();
  let debCent = 0;
  let creCent = 0;
  const codigos = filas.map((f) => String(f.cuenta ?? '').trim()).filter(Boolean);
  const cuentasBd = codigos.length
    ? await pool.query(
        'SELECT codigo, es_detalle, activa FROM cuentas WHERE codigo = ANY($1)',
        [codigos]
      )
    : { rows: [] as Array<{ codigo: string; es_detalle: boolean; activa: boolean }> };
  const porCodigo = new Map(cuentasBd.rows.map((r) => [r.codigo as string, r]));
  for (const f of filas) {
    const cuenta = String(f.cuenta ?? '').trim();
    const d = num(f.debito ?? 0);
    const cr = num(f.credito ?? 0);
    if (!cuenta) { errores.push('Fila de balanza sin código de cuenta'); continue; }
    if (vistas.has(cuenta)) { errores.push(`Cuenta ${cuenta} repetida en la balanza`); continue; }
    vistas.add(cuenta);
    if (!Number.isFinite(d) || !Number.isFinite(cr) || d < 0 || cr < 0) {
      errores.push(`Cuenta ${cuenta}: débito/crédito inválido`); continue;
    }
    if (d > 0 && cr > 0) { errores.push(`Cuenta ${cuenta}: trae débito Y crédito — dejá solo el saldo de un lado`); continue; }
    if (d === 0 && cr === 0) continue; // saldo cero: se ignora
    const info = porCodigo.get(cuenta);
    if (!info) { errores.push(`La cuenta ${cuenta} no existe en el catálogo`); continue; }
    if (!info.es_detalle) { errores.push(`La cuenta ${cuenta} es de mayor — los saldos van en cuentas de DETALLE`); continue; }
    if (!info.activa) { errores.push(`La cuenta ${cuenta} está inactiva`); continue; }
    debCent += aCentavos(d);
    creCent += aCentavos(cr);
    balanza.push({ cuenta, debito: d, credito: cr });
  }
  if (debCent !== creCent) {
    errores.push(
      `La balanza NO cuadra: débitos ${(debCent / 100).toFixed(2)} vs créditos ${(creCent / 100).toFixed(2)} ` +
      `(diferencia ${((debCent - creCent) / 100).toFixed(2)})`
    );
  }

  // --- cuentas de enlace ---
  const cfg = await leerConfig(pool, ['cuenta_cxc', 'cuenta_cxp', 'cuenta_inventario']);
  const cuentaCxc = cfg.cuenta_cxc ?? '';
  const cuentaCxp = cfg.cuenta_cxp ?? '';
  const cuentaInv = cfg.cuenta_inventario ?? '';
  const saldoDe = (cuenta: string, lado: 'deudor' | 'acreedor'): number => {
    const f = balanza.find((x) => x.cuenta === cuenta);
    if (!f) return 0;
    return lado === 'deudor' ? aCentavos(f.debito) - aCentavos(f.credito) : aCentavos(f.credito) - aCentavos(f.debito);
  };
  const saldoCxcCent = saldoDe(cuentaCxc, 'deudor');
  const saldoCxpCent = saldoDe(cuentaCxp, 'acreedor');
  const saldoInvCent = saldoDe(cuentaInv, 'deudor');

  // --- terceros (clientes y proveedores comparten la lógica) ---
  async function resolverTerceros(
    lista: FilaTercero[] | undefined,
    tipoEsperado: 'cliente' | 'proveedor',
    destino: TerceroResuelto[]
  ): Promise<number> {
    let totalCent = 0;
    const nombresVistos = new Set<string>();
    for (const f of Array.isArray(lista) ? lista : []) {
      const nombre = String(f.nombre ?? '').trim();
      const ruc = String(f.ruc ?? '').trim();
      const saldo = num(f.saldo);
      const etiqueta = tipoEsperado === 'cliente' ? 'Cliente' : 'Proveedor';
      if (!nombre && !ruc) { errores.push(`${etiqueta} sin nombre ni RUC`); continue; }
      if (!Number.isFinite(saldo) || saldo <= 0) { errores.push(`${etiqueta} ${nombre || ruc}: saldo inválido (debe ser > 0)`); continue; }
      const llave = (ruc || nombre).toLowerCase();
      if (nombresVistos.has(llave)) { errores.push(`${etiqueta} ${nombre || ruc} repetido — consolidá su saldo en una sola fila`); continue; }
      nombresVistos.add(llave);
      let t = ruc
        ? await pool.query('SELECT id FROM terceros WHERE ruc = $1', [ruc])
        : { rowCount: 0, rows: [] as Array<{ id: number }> };
      if (t.rowCount === 0 && nombre) {
        t = await pool.query('SELECT id FROM terceros WHERE lower(nombre) = lower($1)', [nombre]);
      }
      if ((t.rowCount ?? 0) > 1) { errores.push(`${etiqueta} ${nombre || ruc}: hay varios terceros con ese nombre — usá el RUC`); continue; }
      if (t.rowCount === 0 && !c.crear_terceros) {
        errores.push(`${etiqueta} ${nombre || ruc} no existe — crealo en Configuración o marcá "crear terceros faltantes"`);
        continue;
      }
      totalCent += aCentavos(saldo);
      destino.push({ ruc: ruc || undefined, nombre: nombre || ruc, saldo, tercero_id: t.rowCount ? Number(t.rows[0].id) : null });
    }
    return totalCent;
  }
  const carteraCent = await resolverTerceros(c.clientes, 'cliente', clientes);
  const cxpCent = await resolverTerceros(c.proveedores, 'proveedor', proveedores);

  if (clientes.length > 0 && carteraCent !== saldoCxcCent) {
    errores.push(
      `La cartera de clientes suma ${(carteraCent / 100).toFixed(2)} pero la cuenta CxC (${cfg.cuenta_cxc}) ` +
      `trae ${(saldoCxcCent / 100).toFixed(2)} — deben ser IGUALES al centavo`
    );
  }
  if (clientes.length === 0 && saldoCxcCent !== 0) {
    avisos.push(`La cuenta CxC trae ${(saldoCxcCent / 100).toFixed(2)} sin detalle por cliente: no habrá facturas donde aplicar los cobros`);
  }
  if (proveedores.length > 0 && cxpCent !== saldoCxpCent) {
    errores.push(
      `Los proveedores suman ${(cxpCent / 100).toFixed(2)} pero la cuenta CxP (${cfg.cuenta_cxp}) ` +
      `trae ${(saldoCxpCent / 100).toFixed(2)} — deben ser IGUALES al centavo`
    );
  }
  if (proveedores.length === 0 && saldoCxpCent !== 0) {
    avisos.push(`La cuenta CxP trae ${(saldoCxpCent / 100).toFixed(2)} sin detalle por proveedor: no habrá documentos donde aplicar los pagos`);
  }

  // --- inventario ---
  let invCent = 0;
  const combos = new Set<string>();
  for (const f of Array.isArray(c.inventario) ? c.inventario : []) {
    const codigo = String(f.producto ?? '').trim();
    const bodega = String(f.bodega ?? '').trim();
    const cantidad = num(f.cantidad);
    const costo = num(f.costo_unitario);
    if (!codigo || !bodega) { errores.push('Fila de inventario sin producto o bodega'); continue; }
    if (!Number.isFinite(cantidad) || cantidad <= 0) { errores.push(`Inventario ${codigo}: cantidad inválida`); continue; }
    if (!Number.isFinite(costo) || costo < 0) { errores.push(`Inventario ${codigo}: costo inválido`); continue; }
    if (combos.has(`${codigo}|${bodega}`)) { errores.push(`Inventario ${codigo} repetido en la bodega ${bodega}`); continue; }
    combos.add(`${codigo}|${bodega}`);
    const p = await pool.query('SELECT id, activo FROM productos WHERE codigo = $1', [codigo]);
    if (p.rowCount === 0) { errores.push(`El producto ${codigo} no existe — cargalo antes en Configuración → Productos`); continue; }
    if (!p.rows[0].activo) { errores.push(`El producto ${codigo} está inactivo`); continue; }
    const b = await pool.query('SELECT 1 FROM bodegas WHERE codigo = $1 AND activa', [bodega]);
    if (b.rowCount === 0) { errores.push(`La bodega ${bodega} no existe o está inactiva`); continue; }
    invCent += Math.round(cantidad * aCentavos(costo));
    inventario.push({ producto: codigo, bodega, cantidad, costo_unitario: costo, producto_id: Number(p.rows[0].id) });
  }
  if (inventario.length > 0 && invCent !== saldoInvCent) {
    errores.push(
      `El inventario valorizado suma ${(invCent / 100).toFixed(2)} pero la cuenta Inventario (${cfg.cuenta_inventario}) ` +
      `trae ${(saldoInvCent / 100).toFixed(2)} — deben ser IGUALES al centavo`
    );
  }
  if (inventario.length === 0 && saldoInvCent !== 0) {
    avisos.push(`La cuenta Inventario trae ${(saldoInvCent / 100).toFixed(2)} sin detalle por producto: el kardex quedará en cero`);
  }

  return {
    errores,
    avisos,
    totales: {
      debitos: debCent / 100,
      creditos: creCent / 100,
      diferencia: (debCent - creCent) / 100,
      cartera: carteraCent / 100,
      proveedores: cxpCent / 100,
      inventario: invCent / 100,
      saldo_cxc: saldoCxcCent / 100,
      saldo_cxp: saldoCxpCent / 100,
      saldo_inventario: saldoInvCent / 100,
    },
    balanza,
    clientes,
    proveedores,
    inventario,
  };
}

/* -------------------------------------------------------------- estado */

rutasApertura.get('/', requierePermiso('contabilidad', 'ver'), envolver(async (_req, res) => {
  const asiento = await pool.query(
    `SELECT a.id, a.fecha, a.concepto,
            (SELECT COALESCE(SUM(debito), 0) FROM movimientos WHERE asiento_id = a.id) AS total
     FROM asientos a WHERE a.tipo_origen = 'apertura' AND NOT a.anulado LIMIT 1`
  );
  const conteos = await pool.query(`
    SELECT (SELECT count(*)::int FROM asientos)                AS asientos,
           (SELECT count(*)::int FROM facturas)                AS facturas,
           (SELECT count(*)::int FROM recibos)                 AS recibos,
           (SELECT count(*)::int FROM compras)                 AS compras,
           (SELECT count(*)::int FROM movimientos_banco)       AS movimientos_banco,
           (SELECT count(*)::int FROM polizas)                 AS polizas,
           (SELECT count(*)::int FROM traslados)               AS traslados,
           (SELECT count(*)::int FROM movimientos_inventario)  AS kardex`);
  const detalle = asiento.rowCount
    ? await pool.query(
        `SELECT (SELECT count(*)::int FROM facturas WHERE origen = 'apertura' AND estado = 'emitida') AS clientes,
                (SELECT count(*)::int FROM compras  WHERE numero_documento LIKE 'INI-%' AND estado = 'registrada') AS proveedores,
                (SELECT count(*)::int FROM movimientos_inventario WHERE origen_tipo = 'apertura' AND origen_id = $1) AS inventario`,
        [asiento.rows[0].id]
      )
    : null;
  res.json({
    cargada: (asiento.rowCount ?? 0) > 0,
    apertura: asiento.rows[0] ?? null,
    auxiliares: detalle?.rows[0] ?? null,
    datos_actuales: conteos.rows[0],
  });
}));

/* ------------------------------------------------------ validar (dry-run) */

rutasApertura.post('/validar', requierePermiso('contabilidad', 'cerrar'), envolver(async (req, res) => {
  const v = await validarApertura((req.body ?? {}) as CuerpoApertura);
  res.json({
    valida: v.errores.length === 0,
    errores: v.errores,
    avisos: v.avisos,
    totales: v.totales,
    filas: { balanza: v.balanza.length, clientes: v.clientes.length, proveedores: v.proveedores.length, inventario: v.inventario.length },
  });
}));

/* --------------------------------------------------------------- cargar */

rutasApertura.post('/cargar', requierePermiso('contabilidad', 'cerrar'), envolver(async (req, res) => {
  const cuerpo = (req.body ?? {}) as CuerpoApertura;
  const v = await validarApertura(cuerpo);
  if (v.errores.length > 0) {
    res.status(400).json({ error: 'La apertura no pasa la validación', errores: v.errores });
    return;
  }
  const fecha = cuerpo.fecha!;
  const usuario = req.usuario!.id;

  const resultado = await enTransaccion(async (bd: PoolClient) => {
    // 1) terceros faltantes
    for (const lista of [{ filas: v.clientes, tipo: 'cliente' }, { filas: v.proveedores, tipo: 'proveedor' }]) {
      for (const t of lista.filas) {
        if (t.tercero_id === null) {
          const nuevo = await bd.query(
            `INSERT INTO terceros (ruc, nombre, tipo, creado_por) VALUES ($1, $2, $3, $4) RETURNING id`,
            [t.ruc ?? null, t.nombre, lista.tipo, usuario]
          );
          t.tercero_id = Number(nuevo.rows[0].id);
        }
      }
    }

    // 2) asiento único de apertura (el trigger diferido verifica el cuadre)
    const asiento = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, concepto, creado_por)
       VALUES ($1, $2, 'apertura', $3, $4) RETURNING id`,
      [fecha, fecha.slice(0, 7), `Saldos iniciales al ${fecha} (sistema anterior)`, usuario]
    );
    const asientoId = Number(asiento.rows[0].id);
    for (const f of v.balanza) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito) VALUES ($1, $2, $3, $4)`,
        [asientoId, f.cuenta, f.debito, f.credito]
      );
    }

    // 3) cartera: factura de apertura por cliente (auxiliar, SIN asiento)
    for (const cli of v.clientes) {
      const n = await bd.query(
        `UPDATE series SET ultimo_numero = ultimo_numero + 1 WHERE serie = 'INI' RETURNING ultimo_numero, prefijo`
      );
      const numero: number = n.rows[0].ultimo_numero;
      const numeroCompleto = `${n.rows[0].prefijo}${String(numero).padStart(6, '0')}`;
      // nace borrador (el trigger de líneas lo exige) y se emite en la misma tx
      const factura = await bd.query(
        `INSERT INTO facturas (serie, fecha, tercero_id, tipo_pago, estado, origen,
                               subtotal, iva, total, notas, creado_por)
         VALUES ('INI', $1, $2, 'credito', 'borrador', 'apertura', $3, 0, $3, $4, $5)
         RETURNING id`,
        [fecha, cli.tercero_id, cli.saldo, 'Saldo inicial del sistema anterior', usuario]
      );
      await bd.query(
        `INSERT INTO factura_lineas (factura_id, descripcion, cantidad, precio_unitario, total)
         VALUES ($1, 'Saldo inicial del sistema anterior', 1, $2, $2)`,
        [factura.rows[0].id, cli.saldo]
      );
      await bd.query(
        `UPDATE facturas SET estado = 'emitida', numero = $2, numero_completo = $3, emitida_en = now()
         WHERE id = $1`,
        [factura.rows[0].id, numero, numeroCompleto]
      );
    }

    // 4) proveedores: compra de apertura (auxiliar, SIN asiento ni kardex)
    let secuencia = 0;
    const bodegaCualquiera = await bd.query('SELECT codigo FROM bodegas WHERE activa ORDER BY codigo LIMIT 1');
    for (const prov of v.proveedores) {
      secuencia += 1;
      await bd.query(
        `INSERT INTO compras (tercero_id, numero_documento, fecha, tipo_pago, bodega, estado,
                              subtotal, iva, total, notas, registrada_en, creado_por)
         VALUES ($1, $2, $3, 'credito', $4, 'registrada', $5, 0, $5, $6, now(), $7)`,
        [prov.tercero_id, `INI-${String(secuencia).padStart(4, '0')}`, fecha,
         bodegaCualquiera.rows[0]?.codigo, prov.saldo, 'Saldo inicial del sistema anterior', usuario]
      );
    }

    // 5) inventario: entrada de kardex al costo cargado (fija el promedio)
    for (const inv of v.inventario) {
      await entradaInventario(
        bd,
        { fecha, productoId: inv.producto_id, bodega: inv.bodega, cantidad: inv.cantidad,
          usuarioId: usuario, origenTipo: 'apertura', origenId: asientoId },
        inv.costo_unitario
      );
    }

    await registrarBitacora(bd, usuario, 'cargar_apertura', 'asientos', String(asientoId), {
      fecha,
      cuentas: v.balanza.length,
      clientes: v.clientes.length,
      proveedores: v.proveedores.length,
      inventario: v.inventario.length,
      total: v.totales.debitos,
    });
    return { asiento_id: asientoId };
  });

  res.status(201).json({ ...resultado, avisos: v.avisos, totales: v.totales });
}));

/* --------------------------------------------------------------- anular */

rutasApertura.post('/anular', requierePermiso('contabilidad', 'cerrar'), envolver(async (req, res) => {
  const { motivo } = req.body ?? {};
  if (!motivo) {
    res.status(400).json({ error: 'Anular la apertura exige un motivo (queda en bitácora)' });
    return;
  }
  const hoy = new Date().toISOString().slice(0, 10);
  const usuario = req.usuario!.id;

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; contra?: number }> => {
    const a = await bd.query(
      `SELECT id, fecha FROM asientos WHERE tipo_origen = 'apertura' AND NOT anulado LIMIT 1 FOR UPDATE`
    );
    if (a.rowCount === 0) return { error: 404, mensaje: 'No hay apertura cargada' };
    const asientoId = Number(a.rows[0].id);

    // Nada aplicado encima: si ya hay cobros o pagos contra los auxiliares, primero se anulan esos
    const cobrado = await bd.query(
      `SELECT count(*)::int AS n FROM recibo_aplicaciones ra
       JOIN recibos r ON r.id = ra.recibo_id AND r.estado = 'emitido'
       JOIN facturas f ON f.id = ra.factura_id AND f.origen = 'apertura'`
    );
    if (Number(cobrado.rows[0].n) > 0) {
      return { error: 409, mensaje: 'Hay recibos aplicados a facturas de apertura — anulalos primero' };
    }
    const pagado = await bd.query(
      `SELECT count(*)::int AS n FROM pago_aplicaciones pa
       JOIN movimientos_banco mb ON mb.id = pa.movimiento_banco_id AND mb.estado = 'emitido'
       JOIN compras c ON c.id = pa.compra_id AND c.numero_documento LIKE 'INI-%'`
    );
    if (Number(pagado.rows[0].n) > 0) {
      return { error: 409, mensaje: 'Hay pagos aplicados a compras de apertura — anulalos primero' };
    }

    // El inventario de la apertura debe seguir en las bodegas para poder regresarlo
    const kardexApertura = await bd.query(
      `SELECT producto_id, bodega, cantidad, costo_unitario FROM movimientos_inventario
       WHERE origen_tipo = 'apertura' AND origen_id = $1 AND tipo = 'ajuste_entrada'`,
      [asientoId]
    );
    for (const k of kardexApertura.rows) {
      const e = await bd.query(
        'SELECT COALESCE(cantidad, 0) AS c FROM existencias WHERE producto_id = $1 AND bodega = $2',
        [k.producto_id, k.bodega]
      );
      if (Number(e.rows[0]?.c ?? 0) < Number(k.cantidad)) {
        const p = await bd.query('SELECT codigo FROM productos WHERE id = $1', [k.producto_id]);
        return {
          error: 409,
          mensaje: `No se puede anular: la bodega ${k.bodega} ya no tiene las ${k.cantidad} unidades de ${p.rows[0]?.codigo} de la apertura (¿se vendieron?)`,
        };
      }
    }

    // Contra-asiento espejo
    const movs = await bd.query('SELECT * FROM movimientos WHERE asiento_id = $1 ORDER BY id', [asientoId]);
    const contra = await bd.query(
      `INSERT INTO asientos (fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por)
       VALUES ($1, $2, 'contra_asiento', $3, $4, $5) RETURNING id`,
      [hoy, hoy.slice(0, 7), asientoId, `Anulación de la apertura #${asientoId}: ${motivo}`, usuario]
    );
    for (const m of movs.rows) {
      await bd.query(
        `INSERT INTO movimientos (asiento_id, cuenta, debito, credito) VALUES ($1, $2, $3, $4)`,
        [contra.rows[0].id, m.cuenta, m.credito, m.debito]
      );
    }
    await bd.query('UPDATE asientos SET anulado = true, anulado_por = $2 WHERE id = $1', [asientoId, contra.rows[0].id]);

    // Auxiliares en espejo
    await bd.query(
      `UPDATE facturas SET estado = 'anulada', actualizado_por = $1, actualizado_en = now()
       WHERE origen = 'apertura' AND estado = 'emitida'`,
      [usuario]
    );
    await bd.query(
      `UPDATE compras SET estado = 'anulada', actualizado_por = $1, actualizado_en = now()
       WHERE numero_documento LIKE 'INI-%' AND estado = 'registrada'`,
      [usuario]
    );
    for (const k of kardexApertura.rows) {
      await revertirEntrada(
        bd,
        { fecha: hoy, productoId: Number(k.producto_id), bodega: k.bodega, cantidad: Number(k.cantidad),
          usuarioId: usuario, origenTipo: 'apertura', origenId: asientoId },
        Number(k.costo_unitario)
      );
    }

    await registrarBitacora(bd, usuario, 'anular_apertura', 'asientos', String(asientoId), {
      motivo,
      contra_asiento: contra.rows[0].id,
    });
    return { contra: Number(contra.rows[0].id) };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.json({ ok: true, contra_asiento: resultado.contra });
}));

/* ------------------- convertir la balanza detallada del sistema viejo */

interface FilaDetalle {
  grupo: string;        // 'Cod.Nivel 1'  ej. '1 1 4'
  grupo_nombre: string; // 'CUENTAS X COBRAR'
  codigo: string;       // '1 1 4 2 2 1 216'
  nombre: string;
  final: number;        // Balance Final firmado: + deudor / − acreedor
}

const aGuiones = (codigo: string): string => codigo.trim().split(/\s+/).join('-');

function tipoCuentaVieja(codigo: string, grupoNombre: string): string {
  const primero = codigo.trim()[0];
  if (primero === '1') return 'activo';
  if (primero === '2') return 'pasivo';
  if (primero === '3') return 'capital';
  if (primero === '4') return 'ingreso';
  if (/COSTO/i.test(grupoNombre)) return 'costo';
  return 'gasto';
}

/** Convierte la balanza de detalle exportada del sistema anterior en el
 *  paquete de apertura: los CLIENTES (grupo CUENTAS X COBRAR) y PROVEEDORES
 *  (subgrupo 2 1 1 1) se vuelven auxiliares; el INVENTARIO se agrega a una
 *  cuenta global (el kardex necesita el reporte de existencias aparte); el
 *  resto de cuentas se CREA en el catálogo con el código viejo en guiones.
 *  Los residuos (±centavos) van a una cuenta de ajuste para cuadrar exacto. */
rutasApertura.post('/convertir-detalle', requierePermiso('contabilidad', 'cerrar'), envolver(async (req, res) => {
  const { filas: crudas } = (req.body ?? {}) as { filas?: FilaDetalle[] };
  if (!Array.isArray(crudas) || crudas.length === 0) {
    res.status(400).json({ error: 'No llegaron filas de la balanza' });
    return;
  }
  const avisos: string[] = [];
  const clientes: Array<{ nombre: string; saldo: number }> = [];
  const proveedores: Array<{ nombre: string; saldo: number }> = [];
  const cuentasNuevas = new Map<string, { nombre: string; tipo: string; grupo: string; grupoNombre: string }>();
  const balanza: Array<{ cuenta: string; cent: number }> = [];
  let cxcCent = 0;
  let cxpCent = 0;
  let invCent = 0;
  let residuoCent = 0;

  for (const f of crudas) {
    const final = Number(f.final);
    if (!Number.isFinite(final)) continue;
    const cent = Math.round(final * 100); // firmado: + deudor / − acreedor
    const codigo = String(f.codigo ?? '').trim();
    const nombre = String(f.nombre ?? '').trim();
    const grupoNombre = String(f.grupo_nombre ?? '').trim().toUpperCase();
    const esProveedor = /^2\s+1\s+1\s+1\s/.test(codigo);

    if (/CUENTAS X COBRAR$/.test(grupoNombre) || /^1\s+1\s+4\s/.test(codigo)) {
      if (cent > 0) { clientes.push({ nombre, saldo: cent / 100 }); cxcCent += cent; }
      else residuoCent += cent; // residuos y contra-saldos de la cartera
      continue;
    }
    if (esProveedor) {
      if (cent < 0) { proveedores.push({ nombre, saldo: -cent / 100 }); cxpCent += -cent; }
      else residuoCent += cent;
      continue;
    }
    if (/INVENTARIO/.test(grupoNombre)) {
      invCent += cent; // valor global; el detalle por producto vive en el kardex
      continue;
    }
    if (cent === 0) continue; // cuenta sin saldo: no estorba en la apertura
    const nuevo = aGuiones(codigo);
    if (!nuevo || cuentasNuevas.has(nuevo)) { residuoCent += cent; continue; }
    cuentasNuevas.set(nuevo, {
      nombre: nombre || nuevo,
      tipo: tipoCuentaVieja(codigo, grupoNombre),
      grupo: aGuiones(String(f.grupo ?? '')),
      grupoNombre: String(f.grupo_nombre ?? '').trim(),
    });
    balanza.push({ cuenta: nuevo, cent });
  }

  // Cuentas de enlace agregadas (los auxiliares NO se crean como cuentas)
  const ENLACES: Array<{ codigo: string; nombre: string; tipo: string; cent: number; clave: string }> = [
    { codigo: '1-1-4', nombre: 'CUENTAS POR COBRAR CLIENTES', tipo: 'activo', cent: cxcCent, clave: 'cuenta_cxc' },
    { codigo: '2-1-1-1', nombre: 'PROVEEDORES', tipo: 'pasivo', cent: -cxpCent, clave: 'cuenta_cxp' },
    { codigo: '1-1-3', nombre: 'INVENTARIOS', tipo: 'activo', cent: invCent, clave: 'cuenta_inventario' },
  ];
  for (const e of ENLACES) {
    if (e.cent !== 0) balanza.push({ cuenta: e.codigo, cent: e.cent });
  }

  // Los residuos descartados NO entran; la cuenta de ajuste absorbe el
  // descuadre que dejan (más cualquier centavo de origen) y todo cierra exacto.
  const suma = balanza.reduce((t, b) => t + b.cent, 0);
  if (suma !== 0) balanza.push({ cuenta: '3-99', cent: -suma });
  void residuoCent; // informativo: se reporta en los avisos vía la cuenta 3-99

  const usuario = req.usuario!.id;
  await enTransaccion(async (bd: PoolClient) => {
    // Encabezados de grupo (es_detalle = false) para que el catálogo tenga forma
    const grupos = new Map<string, string>();
    for (const c of cuentasNuevas.values()) {
      if (c.grupo && !grupos.has(c.grupo)) grupos.set(c.grupo, c.grupoNombre || c.grupo);
    }
    for (const [codigo, nombre] of grupos) {
      await bd.query(
        `INSERT INTO cuentas (codigo, nombre, tipo, nivel, es_detalle)
         VALUES ($1, $2, $3, 1, false) ON CONFLICT (codigo) DO NOTHING`,
        [codigo, nombre, tipoCuentaVieja(codigo.replace(/-/g, ' '), nombre)]
      );
    }
    for (const [codigo, c] of cuentasNuevas) {
      await bd.query(
        `INSERT INTO cuentas (codigo, nombre, tipo, padre, nivel, es_detalle)
         VALUES ($1, $2, $3, $4, 2, true) ON CONFLICT (codigo) DO NOTHING`,
        [codigo, c.nombre, c.tipo, grupos.has(c.grupo) ? c.grupo : null]
      );
    }
    for (const e of ENLACES) {
      await bd.query(
        `INSERT INTO cuentas (codigo, nombre, tipo, nivel, es_detalle)
         VALUES ($1, $2, $3, 1, true) ON CONFLICT (codigo) DO NOTHING`,
        [e.codigo, e.nombre, e.tipo]
      );
      await bd.query(`UPDATE config SET valor = $2 WHERE clave = $1`, [e.clave, e.codigo]);
    }
    await bd.query(
      `INSERT INTO cuentas (codigo, nombre, tipo, nivel, es_detalle)
       VALUES ('3-99', 'AJUSTES DE APERTURA (RESIDUOS SISTEMA ANTERIOR)', 'capital', 1, true)
       ON CONFLICT (codigo) DO NOTHING`
    );
    await registrarBitacora(bd, usuario, 'convertir_balanza', 'cuentas', 'importador', {
      filas: crudas.length,
      cuentas_creadas: cuentasNuevas.size,
      clientes: clientes.length,
      proveedores: proveedores.length,
      inventario: invCent / 100,
    });
  });

  avisos.push(
    `Inventario global C$ ${(invCent / 100).toFixed(2)} en la cuenta 1-1-3 — para armar el KARDEX ` +
    `(cantidades y costos por producto/bodega) subí también el reporte de existencias en la hoja 4`
  );
  avisos.push(
    'Revisá en Configuración → Parámetros las cuentas de enlace restantes con el catálogo nuevo: ' +
    'cuenta_caja, cuenta_ventas, cuenta_iva, cuenta_iva_acreditable, cuenta_costo_ventas y cuenta_resultados_acumulados'
  );
  const sospechosas = crudas.filter((f) => /^\d+[.,]\d+$/.test(String(f.grupo ?? '').trim())).length;
  if (sospechosas > 0) {
    avisos.push(
      `${sospechosas} fila(s) del export vienen corruptas (la columna Cod.Nivel 1 trae un número) — ` +
      `revisalas en el Excel o re-exportá; su efecto cae en la cuenta de ajuste 3-99`
    );
  }
  const ajusteFinal = balanza.find((b) => b.cuenta === '3-99');
  if (ajusteFinal) {
    avisos.push(`Residuos y descuadre del sistema anterior absorbidos en la cuenta 3-99: C$ ${(Math.abs(ajusteFinal.cent) / 100).toFixed(2)}`);
  }

  res.json({
    balanza: balanza.map((b) => ({
      cuenta: b.cuenta,
      debito: b.cent > 0 ? b.cent / 100 : 0,
      credito: b.cent < 0 ? -b.cent / 100 : 0,
    })),
    clientes,
    proveedores,
    cuentas_creadas: cuentasNuevas.size,
    avisos,
    totales: { cartera: cxcCent / 100, proveedores: cxpCent / 100, inventario: invCent / 100 },
  });
}));

/* ------------------- convertir el reporte de existencias por bodega */

interface FilaExistencia {
  codigo: string;
  nombre: string;
  categoria?: string;
  costo: number;                 // costo unitario en córdobas (columna COSTO)
  precio?: number;               // precio de venta ya convertido a NIO (opcional)
  existencias: Array<{ bodega: string; cantidad: number }>;
}

/** Recibe el reporte de existencias YA mapeado (columna→bodega, hecho en la
 *  pantalla), CREA los productos que falten en el catálogo (código, nombre,
 *  categoría, precio) y devuelve la hoja de inventario para la apertura.
 *  Cantidades microscópicas (los 0.000001 del sistema viejo) se descartan. */
rutasApertura.post('/convertir-existencias', requierePermiso('contabilidad', 'cerrar'), envolver(async (req, res) => {
  const { filas, crear_productos } = (req.body ?? {}) as { filas?: FilaExistencia[]; crear_productos?: boolean };
  if (!Array.isArray(filas) || filas.length === 0) {
    res.status(400).json({ error: 'No llegaron filas del reporte de existencias' });
    return;
  }
  const bodegasBd = await pool.query('SELECT codigo FROM bodegas WHERE activa');
  const bodegasValidas = new Set(bodegasBd.rows.map((b) => b.codigo as string));
  if (bodegasValidas.size === 0) {
    res.status(400).json({ error: 'No hay bodegas activas — crealas primero en Configuración → Bodegas' });
    return;
  }

  const avisos: string[] = [];
  const inventario: Array<{ producto: string; bodega: string; cantidad: number; costo_unitario: number }> = [];
  const paraCrear = new Map<string, FilaExistencia>();
  const vistos = new Set<string>();
  let totalCent = 0;
  let sinCosto = 0;

  for (const f of filas) {
    const codigo = String(f.codigo ?? '').trim();
    if (!codigo || vistos.has(codigo)) continue;
    vistos.add(codigo);
    const costo = Number(f.costo);
    const filasBodega = (Array.isArray(f.existencias) ? f.existencias : [])
      .map((e) => ({ bodega: String(e.bodega ?? '').trim(), cantidad: Number(e.cantidad) }))
      .filter((e) => Number.isFinite(e.cantidad) && e.cantidad >= 0.005); // fuera los 0.000001
    const conStock = filasBodega.length > 0;
    if (conStock && (!Number.isFinite(costo) || costo < 0)) {
      sinCosto += 1;
      continue;
    }
    for (const e of filasBodega) {
      if (!bodegasValidas.has(e.bodega)) {
        res.status(400).json({ error: `La bodega ${e.bodega} del mapeo no existe o está inactiva` });
        return;
      }
      inventario.push({ producto: codigo, bodega: e.bodega, cantidad: e.cantidad, costo_unitario: costo });
      totalCent += Math.round(e.cantidad * Math.round(costo * 100));
    }
    paraCrear.set(codigo, f); // el catálogo completo entra, tenga o no stock
  }

  let creados = 0;
  if (crear_productos !== false) {
    const usuario = req.usuario!.id;
    await enTransaccion(async (bd: PoolClient) => {
      for (const [codigo, f] of paraCrear) {
        const r = await bd.query(
          `INSERT INTO productos (codigo, nombre, unidad, categoria, precio_venta, creado_por)
           VALUES ($1, $2, 'unidad', $3, $4, $5) ON CONFLICT (codigo) DO NOTHING`,
          [codigo, String(f.nombre ?? codigo).trim() || codigo, String(f.categoria ?? '').trim() || null,
           Number.isFinite(Number(f.precio)) && Number(f.precio) > 0 ? Number(f.precio) : 0, usuario]
        );
        creados += r.rowCount ?? 0;
      }
      await registrarBitacora(bd, usuario, 'convertir_existencias', 'productos', 'importador', {
        filas: filas.length,
        productos_creados: creados,
        lineas_kardex: inventario.length,
        total: totalCent / 100,
      });
    });
  }

  if (sinCosto > 0) {
    avisos.push(`${sinCosto} producto(s) CON existencia vienen sin costo válido y se saltaron — revisalos en el reporte`);
  }
  const sinPrecio = [...paraCrear.values()].filter((f) => !(Number(f.precio) > 0)).length;
  if (sinPrecio > 0) {
    avisos.push(`${sinPrecio} producto(s) quedaron con precio de venta 0 — cargá los precios en Configuración → Productos (o pasá el tipo de cambio al importar)`);
  }
  avisos.push(
    `Inventario valorizado del reporte: C$ ${(totalCent / 100).toFixed(2)} — la cuenta de inventario de la ` +
    `balanza se ajusta a este total (el kardex manda; la diferencia cae en la cuenta 3-99)`
  );

  res.json({
    inventario,
    total: totalCent / 100,
    productos_creados: creados,
    lineas: inventario.length,
    avisos,
  });
}));

/* ------------------------------------------- limpiar datos de prueba */

/** Borra TODAS las transacciones (asientos, documentos, kardex) dejando los
 *  catálogos, usuarios y la bitácora intactos. Pensado para el arranque:
 *  se prueba con datos de mentira, se limpia y se carga la apertura real.
 *  Solo admin + frase exacta; queda registrado en bitácora (que NO se toca). */
rutasApertura.post('/limpiar', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { confirmacion, incluir_catalogo } = req.body ?? {};
  const frase = String(confirmacion ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (frase !== 'LIMPIAR PRUEBAS') {
    res.status(400).json({ error: 'Escribí LIMPIAR PRUEBAS para confirmar' });
    return;
  }
  const usuario = req.usuario!.id;

  const resumen = await enTransaccion(async (bd: PoolClient) => {
    const antes = await bd.query(`
      SELECT (SELECT count(*)::int FROM asientos)  AS asientos,
             (SELECT count(*)::int FROM facturas)  AS facturas,
             (SELECT count(*)::int FROM recibos)   AS recibos,
             (SELECT count(*)::int FROM compras)   AS compras,
             (SELECT count(*)::int FROM movimientos_banco) AS movimientos_banco,
             (SELECT count(*)::int FROM polizas)   AS polizas,
             (SELECT count(*)::int FROM traslados) AS traslados,
             (SELECT count(*)::int FROM movimientos_inventario) AS kardex,
             (SELECT count(*)::int FROM terceros)  AS terceros,
             (SELECT count(*)::int FROM productos) AS productos`);

    // TRUNCATE en un solo statement resuelve las FKs entre ellas.
    // (TRUNCATE no dispara los triggers de fila que protegen borrados uno a
    // uno — esta es la ÚNICA puerta, y queda en bitácora.)
    const transaccionales = [
      'movimientos', 'asientos',
      'factura_lineas', 'facturas',
      'recibo_aplicaciones', 'recibo_retenciones', 'recibos',
      'nota_credito_lineas', 'notas_credito',
      'compra_lineas', 'compra_retenciones', 'compras',
      'orden_compra_lineas', 'ordenes_compra',
      'poliza_lineas', 'poliza_gastos', 'polizas',
      'pago_aplicaciones', 'movimientos_banco',
      'traslado_lineas', 'traslados',
      'movimientos_inventario', 'existencias',
    ];
    const catalogo = incluir_catalogo ? ['terceros', 'productos'] : [];
    await bd.query(`TRUNCATE ${[...transaccionales, ...catalogo].join(', ')} RESTART IDENTITY`);

    // Estado consecuente: consecutivos y promedios a cero, períodos reabiertos
    await bd.query('UPDATE series SET ultimo_numero = 0');
    if (!incluir_catalogo) {
      await bd.query('UPDATE productos SET costo_promedio = 0');
    }
    await bd.query(`UPDATE periodos SET estado = 'abierto', cerrado_por = NULL, cerrado_en = NULL WHERE estado = 'cerrado'`);

    await registrarBitacora(bd, usuario, 'limpiar_datos', 'sistema', 'todo', {
      borrado: antes.rows[0],
      incluir_catalogo: Boolean(incluir_catalogo),
    });
    return antes.rows[0];
  });

  res.json({ ok: true, borrado: resumen });
}));
