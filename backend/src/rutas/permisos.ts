import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso, MODULOS } from '../auth';
import { registrarBitacora } from '../bitacora';

/** Matriz de permisos (rol → módulo → acción), editable por el admin.
 *  El rol admin NO vive aquí: pasa todo por diseño (bypass en requierePermiso),
 *  así nadie puede dejarse a sí mismo fuera del sistema. */
export const rutasPermisos = Router();

const ROLES = ['contador', 'cajero', 'facturador', 'comprador', 'consulta'];
const ACCIONES = ['ver', 'crear', 'editar', 'anular', 'cerrar'];

rutasPermisos.get('/', requierePermiso('admin', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query('SELECT rol, modulo, accion FROM permisos ORDER BY rol, modulo, accion');
  res.json({
    roles: ROLES,
    modulos: [...MODULOS],
    acciones: ACCIONES,
    permisos: r.rows,
  });
}));

// Prende o apaga UNA celda de la matriz
rutasPermisos.put('/', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { rol, modulo, accion, permitido } = req.body ?? {};
  if (!ROLES.includes(rol) || !(MODULOS as readonly string[]).includes(modulo) || !ACCIONES.includes(accion)) {
    res.status(400).json({ error: 'rol, módulo o acción inválidos' });
    return;
  }
  if (permitido) {
    await pool.query(
      `INSERT INTO permisos (rol, modulo, accion) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [rol, modulo, accion]
    );
  } else {
    await pool.query(`DELETE FROM permisos WHERE rol = $1 AND modulo = $2 AND accion = $3`, [rol, modulo, accion]);
  }
  await registrarBitacora(pool, req.usuario!.id, 'editar_permiso', 'permisos', `${rol}/${modulo}/${accion}`, {
    permitido: Boolean(permitido),
  });
  res.json({ ok: true });
}));
