-- ============================================================================
-- 002 — USUARIOS, ROLES, PERMISOS Y BITÁCORA (§4 del plan)
-- usuarios.id = auth.users.id de Supabase Auth. Sin FK a auth.users a
-- propósito: la migración debe correr también en Postgres "pelado"
-- (docker/VPS futuro). La sincronía se garantiza en el backend al crear
-- el usuario.
-- Permisos por ACCIÓN, no solo por vista (ej.: cajero emite cheques pero
-- no puede anularlos).
-- ============================================================================

CREATE TABLE usuarios (
  id              uuid PRIMARY KEY,
  email           text NOT NULL UNIQUE,
  nombre          text NOT NULL,
  activo          boolean NOT NULL DEFAULT true,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  actualizado_en  timestamptz
);

CREATE TABLE roles (
  codigo      text PRIMARY KEY,
  nombre      text NOT NULL,
  descripcion text
);

CREATE TABLE usuario_roles (
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  rol        text NOT NULL REFERENCES roles(codigo),
  PRIMARY KEY (usuario_id, rol)
);

CREATE TABLE permisos (
  rol    text NOT NULL REFERENCES roles(codigo),
  modulo text NOT NULL,   -- contabilidad, facturacion, cxc, bancos, compras, polizas, reportes, admin
  accion text NOT NULL CHECK (accion IN ('ver','crear','editar','anular','cerrar')),
  PRIMARY KEY (rol, modulo, accion)
);

-- Bitácora de acciones sensibles desde el día 1: anulaciones, cierres,
-- cambios de catálogo y de configuración (quién cambió qué tasa y cuándo).
CREATE TABLE bitacora (
  id         bigserial PRIMARY KEY,
  usuario_id uuid,
  accion     text NOT NULL,      -- ej.: 'anular_asiento', 'cerrar_periodo', 'editar_cuenta'
  entidad    text,               -- tabla o módulo afectado
  entidad_id text,
  detalle    jsonb,              -- antes/después, motivo
  en         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bitacora_usuario ON bitacora (usuario_id, en);
CREATE INDEX bitacora_entidad ON bitacora (entidad, entidad_id);

-- Roles base (los permisos finos se cargan por pantalla de admin, no aquí)
INSERT INTO roles (codigo, nombre, descripcion) VALUES
  ('admin',      'Administrador', 'Acceso total, gestiona usuarios y configuración'),
  ('contador',   'Contador',      'Asientos manuales, cierres, catálogo, reportes'),
  ('cajero',     'Cajero',        'Recibos de cobro y caja; no anula'),
  ('facturador', 'Facturador',    'Emite facturas y notas; no anula'),
  ('comprador',  'Comprador',     'Registra compras y CxP'),
  ('consulta',   'Consulta',      'Solo lectura de reportes');