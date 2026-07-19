import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { pool } from './db';
import { autenticar } from './auth';
import { rutasCuentas } from './rutas/cuentas';
import { rutasPeriodos } from './rutas/periodos';
import { rutasAsientos } from './rutas/asientos';
import { rutasReportes } from './rutas/reportes';
import { rutasClientes } from './rutas/clientes';
import { rutasSeries } from './rutas/series';
import { rutasFacturas } from './rutas/facturas';
import { rutasConfig } from './rutas/config';
import { rutasConfiguracion } from './rutas/configuracion';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/salud', async (_req, res) => {
  try {
    const r = await pool.query('SELECT now() AS ahora');
    res.json({ ok: true, bd: 'conectada', ahora: r.rows[0].ahora });
  } catch {
    res.status(500).json({ ok: false, bd: 'sin conexión' });
  }
});

app.get('/api/yo', autenticar, (req, res) => {
  res.json(req.usuario);
});

app.use('/api/cuentas', autenticar, rutasCuentas);
app.use('/api/periodos', autenticar, rutasPeriodos);
app.use('/api/asientos', autenticar, rutasAsientos);
app.use('/api/clientes', autenticar, rutasClientes);
app.use('/api/series', autenticar, rutasSeries);
app.use('/api/facturas', autenticar, rutasFacturas);
app.use('/api/config', autenticar, rutasConfig);
app.use('/api/configuracion', autenticar, rutasConfiguracion); // sucursales, bodegas, vendedores
app.use('/api', autenticar, rutasReportes); // /api/balanza, /api/mayor/:cuenta

// Traducción de errores de BD a respuestas claras (los triggers hablan español)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as { code?: string; message?: string };
  if (e?.code === 'P0001') {
    res.status(400).json({ error: e.message?.replace(/^.*?: /, '') ?? 'Operación rechazada por la BD' });
    return;
  }
  if (e?.code === '23505') {
    res.status(409).json({ error: 'Ya existe un registro con esa clave' });
    return;
  }
  if (e?.code === '23503') {
    res.status(400).json({ error: 'Referencia a un registro que no existe' });
    return;
  }
  console.error('❌', err);
  res.status(500).json({ error: 'Error interno' });
});

const puerto = Number(process.env.PUERTO ?? 3001);
app.listen(puerto, () => {
  console.log(`🚀 sevasa-contable backend en http://localhost:${puerto}`);
});
