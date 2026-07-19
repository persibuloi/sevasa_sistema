import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db';

dotenv.config();

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

// F0: aquí se monta el middleware de auth (validar JWT de Supabase) y las
// rutas por módulo conforme nazcan las fases (F1 contabilidad, F2 facturación…)

const puerto = Number(process.env.PUERTO ?? 3001);
app.listen(puerto, () => {
  console.log(`🚀 sevasa-contable backend en http://localhost:${puerto}`);
});