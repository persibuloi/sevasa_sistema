import type { RequestHandler } from 'express';
import { pool, enTransaccion } from './db';

export interface UsuarioSesion {
  id: string;
  email: string;
  nombre: string;
  roles: string[];
}

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioSesion;
    }
  }
}

function config() {
  const url = process.env.SUPABASE_URL;
  const llave = process.env.SUPABASE_ANON_KEY;
  if (!url || !llave) {
    throw new Error('❌ Faltan SUPABASE_URL / SUPABASE_ANON_KEY en backend/.env');
  }
  return { url, llave };
}

/** Valida el token de Supabase Auth contra el servidor de auth (sirve para
 *  llaves legacy y nuevas sin manejar secretos de firma), carga el usuario
 *  y sus roles desde Postgres, y lo deja en req.usuario. */
export const autenticar: RequestHandler = (req, res, next) => {
  // Atajo EXCLUSIVO de la suite de pruebas: solo cuando el backend entero
  // apunta a un esquema temporal (ESQUEMA_PRUEBAS) y nunca en producción
  if (process.env.ESQUEMA_PRUEBAS && process.env.NODE_ENV !== 'production') {
    req.usuario = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'pruebas@sevasa.local',
      nombre: 'Usuario de pruebas',
      roles: ['admin'],
    };
    next();
    return;
  }
  (async () => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token) {
      res.status(401).json({ error: 'Sin token de sesión' });
      return;
    }
    const { url, llave } = config();
    let respuesta: Response;
    try {
      respuesta = await fetch(`${url}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: llave },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      res.status(503).json({ error: 'No se pudo validar la sesión (servidor de auth no responde)' });
      return;
    }
    if (!respuesta.ok) {
      res.status(401).json({ error: 'Sesión inválida o vencida' });
      return;
    }
    const auth = (await respuesta.json()) as { id: string; email?: string };

    let u = await pool.query('SELECT id, email, nombre, activo FROM usuarios WHERE id = $1', [auth.id]);
    if (u.rowCount === 0) {
      // Bootstrap ATÓMICO: el PRIMER usuario que entra queda como admin.
      // Advisory lock → dos primeros accesos simultáneos no crean dos admins.
      const creado = await enTransaccion(async (bd) => {
        await bd.query('SELECT pg_advisory_xact_lock(420001)');
        const total = await bd.query('SELECT count(*)::int AS n FROM usuarios');
        if ((total.rows[0]?.n ?? 1) !== 0) return false;
        await bd.query('INSERT INTO usuarios (id, email, nombre) VALUES ($1, $2, $2)', [
          auth.id,
          auth.email ?? auth.id,
        ]);
        await bd.query('INSERT INTO usuario_roles (usuario_id, rol) VALUES ($1, $2)', [auth.id, 'admin']);
        await bd.query(
          `INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, detalle)
           VALUES ($1, 'bootstrap_admin', 'usuarios', $1, $2)`,
          [auth.id, JSON.stringify({ email: auth.email })]
        );
        return true;
      });
      if (!creado) {
        res.status(403).json({ error: 'Usuario no habilitado en el sistema — pedir acceso al administrador' });
        return;
      }
      u = await pool.query('SELECT id, email, nombre, activo FROM usuarios WHERE id = $1', [auth.id]);
    }
    const fila = u.rows[0];
    if (!fila.activo) {
      res.status(403).json({ error: 'Usuario desactivado' });
      return;
    }
    const roles = await pool.query('SELECT rol FROM usuario_roles WHERE usuario_id = $1', [fila.id]);
    req.usuario = {
      id: fila.id,
      email: fila.email,
      nombre: fila.nombre,
      roles: roles.rows.map((r) => r.rol as string),
    };
    next();
  })().catch(next);
};

/** Autorización por acción (no solo por vista): admin pasa siempre; el resto
 *  necesita la fila (rol, módulo, acción) en la tabla permisos. */
export function requierePermiso(modulo: string, accion: string): RequestHandler {
  return (req, res, next) => {
    (async () => {
      const u = req.usuario;
      if (!u) {
        res.status(401).json({ error: 'Sin sesión' });
        return;
      }
      if (u.roles.includes('admin')) {
        next();
        return;
      }
      const r = await pool.query(
        `SELECT 1 FROM permisos p
         JOIN usuario_roles ur ON ur.rol = p.rol
         WHERE ur.usuario_id = $1 AND p.modulo = $2 AND p.accion = $3
         LIMIT 1`,
        [u.id, modulo, accion]
      );
      if (r.rowCount === 0) {
        res.status(403).json({ error: `Sin permiso: ${modulo}/${accion}` });
        return;
      }
      next();
    })().catch(next);
  };
}
