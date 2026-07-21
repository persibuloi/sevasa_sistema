import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool, enTransaccion } from '../db';
import { envolver } from '../util';
import { requierePermiso } from '../auth';
import { registrarBitacora } from '../bitacora';

/** Administración de usuarios: ficha completa + credenciales + roles +
 *  amarres (sucursal/bodega/vendedor). Solo administradores.
 *  Los usuarios NUNCA se borran: se desactivan. */
export const rutasUsuarios = Router();

const ROLES_VALIDOS = ['admin', 'contador', 'cajero', 'facturador', 'comprador', 'consulta'];

rutasUsuarios.get('/', requierePermiso('admin', 'ver'), envolver(async (_req, res) => {
  const r = await pool.query(
    `SELECT u.*, s.nombre AS sucursal_nombre, b.nombre AS bodega_nombre, v.nombre AS vendedor_nombre,
            au.last_sign_in_at AS ultimo_acceso,
            COALESCE(rs.roles, '{}') AS roles
     FROM usuarios u
     LEFT JOIN sucursales s ON s.codigo = u.sucursal
     LEFT JOIN bodegas b ON b.codigo = u.bodega
     LEFT JOIN vendedores v ON v.id = u.vendedor_id
     LEFT JOIN auth.users au ON au.id = u.id
     LEFT JOIN (
       SELECT usuario_id, array_agg(rol ORDER BY rol) AS roles FROM usuario_roles GROUP BY usuario_id
     ) rs ON rs.usuario_id = u.id
     ORDER BY u.nombre`
  );
  res.json(r.rows);
}));

interface CuerpoUsuario {
  email?: string;
  clave?: string;
  nombre?: string;
  cedula?: string;
  telefono?: string;
  direccion?: string;
  cargo?: string;
  fecha_ingreso?: string;
  notas?: string;
  sucursal?: string | null;
  bodega?: string | null;
  vendedor_id?: number | null;
  roles?: string[];
  activo?: boolean;
}

function rolesLimpios(roles: unknown): string[] | null {
  if (!Array.isArray(roles) || roles.length === 0) return null;
  const limpios = roles.map(String).filter((r) => ROLES_VALIDOS.includes(r));
  return limpios.length > 0 ? limpios : null;
}

// Crear: cuenta de login (Supabase Auth vía SQL) + ficha + roles, UNA transacción
rutasUsuarios.post('/', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const c = (req.body ?? {}) as CuerpoUsuario;
  if (!c.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) {
    res.status(400).json({ error: 'Correo inválido' });
    return;
  }
  if (!c.clave || c.clave.length < 8) {
    res.status(400).json({ error: 'La contraseña inicial necesita al menos 8 caracteres' });
    return;
  }
  if (!c.nombre) {
    res.status(400).json({ error: 'El nombre es obligatorio' });
    return;
  }
  const roles = rolesLimpios(c.roles);
  if (!roles) {
    res.status(400).json({ error: 'Asigná al menos un rol válido' });
    return;
  }

  const resultado = await enTransaccion(async (bd: PoolClient): Promise<{ error?: number; mensaje?: string; id?: string }> => {
    const existe = await bd.query('SELECT 1 FROM auth.users WHERE lower(email) = lower($1)', [c.email]);
    if ((existe.rowCount ?? 0) > 0) return { error: 409, mensaje: 'Ya existe un usuario con ese correo' };

    const nuevo = await bd.query(
      `INSERT INTO auth.users (
         instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
         confirmation_token, recovery_token, email_change, email_change_token_new
       ) VALUES (
         '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
         lower($1), extensions.crypt($2, extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
       ) RETURNING id, email`,
      [c.email, c.clave]
    );
    const id = nuevo.rows[0].id as string;
    await bd.query(
      `INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, $1::text,
               jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true),
               'email', now(), now(), now())`,
      [id, nuevo.rows[0].email]
    );
    await bd.query(
      `INSERT INTO usuarios (id, email, nombre, cedula, telefono, direccion, cargo, fecha_ingreso, notas,
                             sucursal, bodega, vendedor_id, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, nuevo.rows[0].email, c.nombre, c.cedula || null, c.telefono || null, c.direccion || null,
       c.cargo || null, c.fecha_ingreso || null, c.notas || null,
       c.sucursal || null, c.bodega || null, c.vendedor_id || null, req.usuario!.id]
    );
    for (const rol of roles) {
      await bd.query('INSERT INTO usuario_roles (usuario_id, rol) VALUES ($1, $2)', [id, rol]);
    }
    await registrarBitacora(bd, req.usuario!.id, 'crear_usuario', 'usuarios', id, {
      email: nuevo.rows[0].email, nombre: c.nombre, roles, sucursal: c.sucursal ?? null,
    });
    return { id };
  });

  if (resultado.error) {
    res.status(resultado.error).json({ error: resultado.mensaje });
    return;
  }
  res.status(201).json({ id: resultado.id });
}));

// Editar ficha + roles + amarres + activo (el correo no se cambia)
rutasUsuarios.put('/:id', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const c = (req.body ?? {}) as CuerpoUsuario;
  const antes = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.params.id]);
  if (antes.rowCount === 0) {
    res.status(404).json({ error: 'Usuario no existe' });
    return;
  }
  const roles = rolesLimpios(c.roles);
  if (c.roles !== undefined && !roles) {
    res.status(400).json({ error: 'Asigná al menos un rol válido' });
    return;
  }
  const a = antes.rows[0];
  await enTransaccion(async (bd: PoolClient) => {
    await bd.query(
      `UPDATE usuarios SET nombre=$2, cedula=$3, telefono=$4, direccion=$5, cargo=$6, fecha_ingreso=$7,
              notas=$8, sucursal=$9, bodega=$10, vendedor_id=$11, activo=$12,
              actualizado_por=$13, actualizado_en=now()
       WHERE id=$1`,
      [req.params.id, c.nombre ?? a.nombre, c.cedula ?? a.cedula, c.telefono ?? a.telefono,
       c.direccion ?? a.direccion, c.cargo ?? a.cargo, c.fecha_ingreso ?? a.fecha_ingreso,
       c.notas ?? a.notas,
       c.sucursal !== undefined ? (c.sucursal || null) : a.sucursal,
       c.bodega !== undefined ? (c.bodega || null) : a.bodega,
       c.vendedor_id !== undefined ? (c.vendedor_id || null) : a.vendedor_id,
       c.activo ?? a.activo, req.usuario!.id]
    );
    if (roles) {
      await bd.query('DELETE FROM usuario_roles WHERE usuario_id = $1', [req.params.id]);
      for (const rol of roles) {
        await bd.query('INSERT INTO usuario_roles (usuario_id, rol) VALUES ($1, $2)', [req.params.id, rol]);
      }
    }
    await registrarBitacora(bd, req.usuario!.id, 'editar_usuario', 'usuarios', String(req.params.id), {
      antes: { nombre: a.nombre, sucursal: a.sucursal, bodega: a.bodega, activo: a.activo },
      despues: { nombre: c.nombre ?? a.nombre, sucursal: c.sucursal ?? a.sucursal, bodega: c.bodega ?? a.bodega, activo: c.activo ?? a.activo, roles },
    });
  });
  res.json({ ok: true });
}));

// Resetear contraseña (el admin define una nueva; el usuario puede cambiarla luego)
rutasUsuarios.post('/:id/reset-clave', requierePermiso('admin', 'editar'), envolver(async (req, res) => {
  const { clave } = req.body ?? {};
  if (typeof clave !== 'string' || clave.length < 8) {
    res.status(400).json({ error: 'La nueva contraseña necesita al menos 8 caracteres' });
    return;
  }
  const r = await pool.query(
    `UPDATE auth.users SET encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')), updated_at = now()
     WHERE id = $1 RETURNING email`,
    [req.params.id, clave]
  );
  if (r.rowCount === 0) {
    res.status(404).json({ error: 'Usuario no existe en el sistema de acceso' });
    return;
  }
  await registrarBitacora(pool, req.usuario!.id, 'reset_clave', 'usuarios', String(req.params.id), {
    email: r.rows[0].email,
  });
  res.json({ ok: true });
}));
