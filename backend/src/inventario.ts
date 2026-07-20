import type { PoolClient } from 'pg';

/** Motor de inventario perpetuo con costo promedio ponderado (global).
 *  TODAS las funciones exigen correr dentro de una transacción y toman
 *  lock de la fila del producto para serializar el cálculo del promedio. */

export interface MovimientoInv {
  fecha: string;
  productoId: number;
  bodega: string;
  cantidad: number;        // siempre positiva; el signo lo pone la operación
  usuarioId: string;
  origenTipo: 'compra' | 'factura' | 'poliza' | 'ajuste';
  origenId: number;
}

async function bloquearProducto(bd: PoolClient, productoId: number): Promise<{ promedio: number; existencia: number }> {
  const p = await bd.query('SELECT costo_promedio FROM productos WHERE id = $1 FOR UPDATE', [productoId]);
  if (p.rowCount === 0) throw new Error(`Producto ${productoId} no existe`);
  const e = await bd.query(
    'SELECT COALESCE(SUM(cantidad), 0) AS total FROM existencias WHERE producto_id = $1',
    [productoId]
  );
  return { promedio: Number(p.rows[0].costo_promedio), existencia: Number(e.rows[0]?.total ?? 0) };
}

async function moverExistencia(bd: PoolClient, productoId: number, bodega: string, delta: number): Promise<void> {
  await bd.query(
    `INSERT INTO existencias (producto_id, bodega, cantidad) VALUES ($1, $2, $3)
     ON CONFLICT (producto_id, bodega) DO UPDATE SET cantidad = existencias.cantidad + $3`,
    [productoId, bodega, delta]
  );
}

async function kardex(
  bd: PoolClient,
  m: MovimientoInv,
  tipo: string,
  cantidadFirmada: number,
  costoUnitario: number
): Promise<void> {
  await bd.query(
    `INSERT INTO movimientos_inventario
       (fecha, producto_id, bodega, tipo, origen_tipo, origen_id, cantidad, costo_unitario, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [m.fecha, m.productoId, m.bodega, tipo, m.origenTipo, m.origenId, cantidadFirmada, costoUnitario, m.usuarioId]
  );
}

/** Entrada por compra/póliza: recalcula el costo promedio ponderado. */
export async function entradaInventario(bd: PoolClient, m: MovimientoInv, costoUnitario: number): Promise<void> {
  const { promedio, existencia } = await bloquearProducto(bd, m.productoId);
  const base = Math.max(existencia, 0); // existencia negativa no pondera el promedio
  const nuevoPromedio = (base * promedio + m.cantidad * costoUnitario) / (base + m.cantidad);
  await bd.query('UPDATE productos SET costo_promedio = $2 WHERE id = $1', [m.productoId, nuevoPromedio.toFixed(4)]);
  await moverExistencia(bd, m.productoId, m.bodega, m.cantidad);
  await kardex(bd, m, m.origenTipo === 'poliza' ? 'entrada_poliza' : 'entrada_compra', m.cantidad, costoUnitario);
}

/** Salida por venta: usa el promedio vigente (no lo cambia). Devuelve el costo unitario aplicado. */
export async function salidaInventario(bd: PoolClient, m: MovimientoInv): Promise<number> {
  const { promedio } = await bloquearProducto(bd, m.productoId);
  await moverExistencia(bd, m.productoId, m.bodega, -m.cantidad);
  await kardex(bd, m, 'salida_venta', -m.cantidad, promedio);
  return promedio;
}

/** Reversa de una entrada (anulación de compra): deshace el promedio. */
export async function revertirEntrada(bd: PoolClient, m: MovimientoInv, costoUnitario: number): Promise<void> {
  const { promedio, existencia } = await bloquearProducto(bd, m.productoId);
  const restante = existencia - m.cantidad;
  if (restante > 0) {
    const nuevoPromedio = (existencia * promedio - m.cantidad * costoUnitario) / restante;
    await bd.query('UPDATE productos SET costo_promedio = $2 WHERE id = $1', [
      m.productoId,
      Math.max(nuevoPromedio, 0).toFixed(4),
    ]);
  }
  await moverExistencia(bd, m.productoId, m.bodega, -m.cantidad);
  await kardex(bd, m, 'anulacion', -m.cantidad, costoUnitario);
}

/** Reversa de una salida (anulación de factura): reingresa al costo con que salió. */
export async function revertirSalida(bd: PoolClient, m: MovimientoInv, costoUnitario: number): Promise<void> {
  const { promedio, existencia } = await bloquearProducto(bd, m.productoId);
  const base = Math.max(existencia, 0);
  const nuevoPromedio = (base * promedio + m.cantidad * costoUnitario) / (base + m.cantidad);
  await bd.query('UPDATE productos SET costo_promedio = $2 WHERE id = $1', [m.productoId, nuevoPromedio.toFixed(4)]);
  await moverExistencia(bd, m.productoId, m.bodega, m.cantidad);
  await kardex(bd, m, 'anulacion', m.cantidad, costoUnitario);
}
