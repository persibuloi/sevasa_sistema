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
import { rutasProductos } from './rutas/productos';
import { rutasCompras } from './rutas/compras';
import { rutasOrdenes } from './rutas/ordenes';
import { rutasProveedores } from './rutas/proveedores';
import { rutasCxc } from './rutas/cxc';
import { rutasTraslados } from './rutas/traslados';
import { rutasBancos } from './rutas/bancos';
import { rutasRetenciones } from './rutas/retenciones';

const app = express();
// En producciÃ³n CORS_ORIGEN es OBLIGATORIO (ej: https://contable.sevasa.com);
// sin Ã©l, el servidor se niega a arrancar â€” nunca CORS abierto en producciÃ³n
const origenes = process.env.CORS_ORIGEN?.split(',').map((s) => s.trim()).filter(Boolean);
if (process.env.NODE_ENV === 'production' && (!origenes || origenes.length === 0)) {
  throw new Error('âŒ En producciÃ³n CORS_ORIGEN es obligatorio (orÃ­genes separados por coma)');
}
app.use(cors(origenes && origenes.length > 0 ? { origin: origenes } : {}));
app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');

// Cabeceras defensivas (API pura, sin HTML)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// LÃ­mite de peticiones por IP: RATE_LIMIT por minuto (default 300, mÃ­nimo 30)
const LIMITE_POR_MINUTO = Math.max(Number(process.env.RATE_LIMIT ?? 300) || 300, 30);
const ventanas = new Map<string, { inicio: number; n: number }>();
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, v] of ventanas) {
    if (ahora - v.inicio > 120_000) ventanas.delete(ip);
  }
}, 300_000).unref();
app.use((req, res, next) => {
  const ip = req.ip ?? 'desconocida';
  const ahora = Date.now();
  const v = ventanas.get(ip);
  if (!v || ahora - v.inicio > 60_000) {
    ventanas.set(ip, { inicio: ahora, n: 1 });
    next();
    return;
  }
  v.n += 1;
  if (v.n > LIMITE_POR_MINUTO) {
    res.status(429).json({ error: 'Demasiadas peticiones â€” esperÃ¡ un momento' });
    return;
  }
  next();
});

app.get('/api/salud', async (_req, res) => {
  try {
    const r = await pool.query('SELECT now() AS ahora');
    res.json({ ok: true, bd: 'conectada', ahora: r.rows[0].ahora });
  } catch {
    res.status(500).json({ ok: false, bd: 'sin conexiÃ³n' });
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
app.use('/api/productos', autenticar, rutasProductos);
app.use('/api/compras', autenticar, rutasCompras);
app.use('/api/ordenes', autenticar, rutasOrdenes);
app.use('/api/proveedores', autenticar, rutasProveedores);
app.use('/api/cxc', autenticar, rutasCxc); // cartera, recibos, notas de crÃ©dito
app.use('/api/traslados', autenticar, rutasTraslados);
app.use('/api/bancos', autenticar, rutasBancos);
app.use('/api/retenciones', autenticar, rutasRetenciones); // tipos + reporte DGI
app.use('/api', autenticar, rutasReportes); // /api/balanza, /api/mayor/:cuenta

// TraducciÃ³n de errores de BD a respuestas claras (los triggers hablan espaÃ±ol)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as { code?: string; message?: string };
  if (e?.code === 'P0001') {
    res.status(400).json({ error: e.message ?? 'OperaciÃ³n rechazada por la BD' });
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
  console.error('âŒ', err);
  res.status(500).json({ error: 'Error interno' });
});

export { app };

