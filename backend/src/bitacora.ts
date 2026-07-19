import type { Pool, PoolClient } from 'pg';

type Ejecutor = Pool | PoolClient;

/** Registra una acción sensible. Dentro de una transacción, pasar el cliente
 *  de la transacción para que la bitácora se revierta junto con la operación. */
export async function registrarBitacora(
  bd: Ejecutor,
  usuarioId: string | null,
  accion: string,
  entidad?: string,
  entidadId?: string,
  detalle?: unknown
): Promise<void> {
  await bd.query(
    `INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, detalle)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      usuarioId,
      accion,
      entidad ?? null,
      entidadId ?? null,
      detalle === undefined ? null : JSON.stringify(detalle),
    ]
  );
}
