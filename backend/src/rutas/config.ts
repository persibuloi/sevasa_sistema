import { Router } from 'express';
import { pool } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

export const rutasConfig = Router();

rutasConfig.get('/', envolver(async (_req, res) => {
  const r = await pool.query('SELECT clave, valor, descripcion FROM config ORDER BY clave');
  res.json(r.rows);
}));

/* --------------------------- tipo de cambio oficial (tabla tipos_cambio) */

rutasConfig.get('/tipo-cambio', envolver(async (_req, res) => {
  const r = await pool.query('SELECT fecha, tasa FROM tipos_cambio ORDER BY fecha DESC LIMIT 1');
  res.json(r.rows[0] ?? null);
}));

rutasConfig.post('/tipo-cambio', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { fecha, tasa } = req.body ?? {};
  const dia = typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? fecha
    : new Date().toISOString().slice(0, 10);
  const valor = Number(tasa);
  if (!Number.isFinite(valor) || valor <= 0) {
    res.status(400).json({ error: 'La tasa debe ser un número mayor que cero (córdobas por dólar)' });
    return;
  }
  const r = await pool.query(
    `INSERT INTO tipos_cambio (fecha, tasa) VALUES ($1, $2)
     ON CONFLICT (fecha) DO UPDATE SET tasa = EXCLUDED.tasa RETURNING fecha, tasa`,
    [dia, valor]
  );
  await registrarBitacora(pool, req.usuario!.id, 'fijar_tipo_cambio', 'tipos_cambio', dia, { tasa: valor });
  res.status(201).json(r.rows[0]);
}));

// Cambiar configuración es acción sensible: solo admin (o quien tenga admin/editar)
rutasConfig.put('/:clave', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { valor } = req.body ?? {};
  if (valor === undefined || valor === null || valor === '') {
    res.status(400).json({ error: 'valor es obligatorio' });
    return;
  }
  const antes = await pool.query('SELECT * FROM config WHERE clave = $1', [req.params.clave]);
  if (antes.rowCount === 0) {
    res.status(404).json({ error: `Clave de configuración "${req.params.clave}" no existe` });
    return;
  }
  const r = await pool.query('UPDATE config SET valor = $2 WHERE clave = $1 RETURNING *', [
    req.params.clave,
    String(valor),
  ]);
  await registrarBitacora(pool, req.usuario!.id, 'editar_config', 'config', req.params.clave, {
    antes: antes.rows[0].valor,
    despues: String(valor),
  });
  res.json(r.rows[0]);
}));
