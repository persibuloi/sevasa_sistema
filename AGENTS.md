# SEVASA Contable — guía del proyecto

Sistema contable-financiero oficial de la empresa (Nicaragua): facturación, CxC, inventario,
compras/CxP, bancos, cheques, pólizas de importación, partida doble y estados financieros.
30 usuarios. El plan maestro vive en `PLAN_SISTEMA_CONTABLE.md` (raíz del repo).

Infraestructura: Supabase Pro "sevasa" (`dqlylcjwvcbxyxsoyhnw`, us-east-2) + Vercel Pro.
EN PRODUCCIÓN: https://sevasa-sistema.vercel.app (GitHub persibuloi/sevasa_sistema, privado;
push a main = deploy automático). Auth: Supabase Auth; el PRIMER usuario que entra queda
como admin (bootstrap en `auth.ts`).

⚠️ DATOS REALES CARGADOS (2026-07-24): apertura de saldos del sistema viejo al
2026-06-30 — asiento #1 por C$ 245,016,092.96, catálogo real (517+ cuentas con el
código viejo en guiones), 103 clientes, 42 proveedores, ~2,600 productos con kardex
por bodega (7,611 líneas). Sucursales reales: CEN Altamira · SUR Los Robles ·
OCC Bello Horizonte · CM Carretera a Masaya, con bodegas cuyo CÓDIGO ES EL NÚMERO
del sistema viejo (1,2,…,13) y su caja propia. Config apunta al catálogo real.
"LIMPIAR PRUEBAS" borraría la apertura: SOLO con orden explícita del usuario.

## Principio rector

El usuario registra DOCUMENTOS (factura, recibo, nota, compra, cheque, póliza); el sistema
genera los ASIENTOS automáticamente. Nadie escribe partida doble a mano salvo ajustes
autorizados (rol contador).

## Arquitectura

- `app/` — React 18 + Vite + TypeScript + Tailwind 4
- `backend/` — Node + Express 4 + TypeScript estricto (un `undefined` silencioso puede
  descuadrar un asiento; TS lo atrapa en compilación)
- `migrations/` — SQL numeradas `001_...` a `008_...` — TODO el esquema versionado
- `docker/` — stack COMPLETO listo (backend.Dockerfile multi-stage con migraciones al
  arrancar, app.Dockerfile con nginx + proxy /api, compose con .env.ejemplo) — PENDIENTE
  DE PROBAR: no hay Docker en esta máquina; se desarrolla contra Supabase directo.
  CLAVE: el login vive en Supabase Auth → la base debe ser Supabase (nube o
  self-hosted); un Postgres pelado no sirve (el perfil `local` del compose es
  solo para respaldos)
- `datos-prueba/` — exports del sistema viejo (EXCLUIDA de git: datos reales no van al historial)

## Reglas duras de la BD (NO relajarlas)

1. Asiento descuadrado = imposible: constraint trigger DIFERIDO al commit
   (`trg_verificar_cuadre`). Documento + asiento + movimientos en UNA transacción.
2. Período cerrado = inmutable a nivel BD (`trg_proteger_asiento` / `trg_proteger_movimiento`).
3. Nada se borra: se ANULA con contra-asiento (`anulado`, `anulado_por`). La balanza
   (`v_balanza`) incluye TODOS los asientos: original + contra se netean. Documentos
   emitidos/registrados son inmutables por trigger (facturas, compras); solo borradores
   se editan o descartan.
4. Solo cuentas de detalle (`es_detalle`) activas reciben movimientos.
5. Multimoneda: montos SIEMPRE en NIO; si el documento es USD van `moneda`,
   `tipo_cambio` (tabla `tipos_cambio`, oficial BCN) y `monto_origen`.
6. Auditoría en toda tabla: `creado_por/en`, `actualizado_por/en`. Acciones sensibles
   (anular, cerrar, emitir, cambiar catálogo/config/precios) → `bitacora`.

## Consecutivos (facturas, recibos, notas de crédito; luego cheques y pólizas)

- La tabla `series` tiene `documento` ('factura'|'recibo'|'nota_credito') y `sucursal`.
  Series de recibos/NC por defecto: REC y NC (claves `serie_recibos` / `serie_notas_credito`
  en config).
- Número tomado DENTRO de la transacción de emisión con row-lock:
  `UPDATE series SET ultimo_numero = ultimo_numero + 1 WHERE serie = $1 RETURNING ultimo_numero`
- NUNCA secuencias de Postgres (huecos en rollback) ni "leer último + 1" en la app.
- La factura nace BORRADOR sin número; toma número al EMITIR. Recibos y NC emiten directo.
- Anulación conserva el número (la DGI exige consecutivo completo). Jamás se reciclan.

## Inventario (DECIDIDO: perpetuo, dentro del sistema)

- Costo promedio ponderado GLOBAL. Kardex (`movimientos_inventario`) = fuente de verdad;
  `existencias` (por bodega) y `productos.costo_promedio` materializados.
- Motor: `backend/src/inventario.ts` — entrada/salida/reversas. SIEMPRE dentro de
  transacción; toma lock de la fila del producto. No usar SQL suelto para tocar inventario.
- Ciclo: OC (control, sin contabilidad) → compra local (asiento Inventario + IVA
  acreditable vs CxP/Caja + kardex + promedio) → factura (descarga al promedio y mete
  costo de venta EN EL MISMO asiento de la venta) → devolución por NC reingresa al costo
  con que salió. La bodega de la venta se resuelve por la sucursal de la serie.
- Existencia insuficiente al facturar: BLOQUEADA por defecto (parámetro
  `ventas_bloquear_sin_existencia`, DECIDIDO por el usuario). salidaInventario
  valida con el producto lockeado (a prueba de concurrencia); el editor avisa
  antes de emitir. Con el parámetro en 'no' vuelve a permitir el negativo (rojo).

## Cuentas de enlace y parámetros (tabla `config`, pantalla Configuración → Parámetros)

`tasa_iva`, `cuenta_caja`, `cuenta_cxc`, `cuenta_ventas`, `cuenta_iva`,
`cuenta_inventario`, `cuenta_iva_acreditable`, `cuenta_cxp`, `cuenta_costo_ventas`,
`serie_recibos`, `serie_notas_credito`. Con el catálogo real solo se cambian estos valores
en pantalla — nada quemado en código. Editar config = permiso admin, queda en bitácora.

## Permisos

Por ACCIÓN vía tabla `permisos` (rol → módulo → ver/crear/editar/anular/cerrar).
Módulos en uso: `contabilidad`, `facturacion`, `compras`, `cxc`, `bancos`, `polizas`,
`inventario`, `admin`. El rol `admin` pasa todo (bypass en `requierePermiso`).
Roles: admin, contador, cajero, facturador, comprador, consulta.

Usuarios (Administración → Usuarios, `rutas/usuarios.ts`): el admin crea la cuenta
completa en UNA transacción — login en `auth.users`/`auth.identities` vía SQL
(extensions.crypt bcrypt, email confirmado), ficha personal (cédula/teléfono/cargo/…),
roles y AMARRES: `usuarios.sucursal/bodega/vendedor_id` (migración 024). Los usuarios
NUNCA se borran: se desactivan. Reset de clave por admin; todo va a bitácora.
AMARRE DURO (decisión del usuario): con sucursal asignada y sin rol admin, solo se
facturan series de ESA sucursal (`serieDeMiSucursal` en borrador Y emitir); con
bodega/sucursal asignada, los traslados solo se ORIGINAN desde la bodega propia (o
las de su sucursal); enviar hacia cualquier bodega es libre. El front espeja los
filtros vía GET /api/yo (sesión con amarres). Foto de usuario: diferida (última).

## Diseño (sistema "libro mayor moderno")

- Tokens en `app/src/index.css` (@theme): tinta/fondo/verde/borde/ámbar/rojo.
  Fuentes: Schibsted Grotesk (UI) + IBM Plex Mono (cifras, clase `.cifra`).
- Clases obligatorias para TODA pantalla nueva (no estilos ad-hoc):
  `.entrada`, `.etiqueta`, `.boton-primario/.boton-suave/.boton-peligro`, `.tarjeta`,
  `.insignia-verde/-ambar/-roja/-gris`, `.tabla`, `.cifra`.
- Shell: sidebar tinta con grupos (Ventas / Compras / Contabilidad / Administración).
  RESPONSIVE: en celular el sidebar es un cajón detrás del botón hamburguesa
  (se cierra solo al navegar); en facturación cada línea pasa de fila de tabla
  a TARJETA por debajo de `md`, y la barra de totales se apila.
- Patrón de páginas: lista con filtros → editor con panel de resumen sticky, o pestañas
  dentro de la página (ver Facturas, Compras, Cobranza, Configuración).

## Convenciones de trabajo

- **NO push sin orden explícita del usuario.**
- Todo en español: tablas, columnas, código, mensajes, commits.
- Logs con emoji: ✅ éxito, ❌ error, ✨ resumen, 🚀 arranque, 🔒 cierre.
- Migraciones: NUNCA DDL suelto pegado a mano (ni vía Supabase MCP) — archivo numerado
  nuevo + `npm run migrate`. Las migraciones aplicadas no se editan. Datos de prueba
  van en `npm run seed` (se niega a correr si ya hay cuentas).
- Escrituras contables SIEMPRE vía `enTransaccion()` (`backend/src/db.ts`).
- Errores de BD → mensajes claros en español (middleware en `index.ts` traduce
  P0001/23505/23503); los triggers ya hablan español.
- PowerShell: los mensajes de commit NO llevan comillas dobles internas (rompen el
  here-string hacia git en PS 5.1).
- Tests de cuadre (Jest, pendiente): asiento descuadrado imposible, balanza suma cero,
  IVA correcto, período cerrado rechaza escritura. Corren antes de cada push.
- Fases chicas probadas E2E con datos reales antes de avanzar (método Sevasa).

## Seguridad (auditoría 2026-07 — migración 014)

- RLS habilitado en TODAS las tablas + REVOKE total a anon/authenticated
  (tablas, VISTAS con security_invoker, secuencias, funciones, USAGE del
  esquema — incluida la herencia vía PUBLIC — y default privileges).
  PostgREST devuelve 401 en tablas Y vistas: el ÚNICO camino es el backend.
  El backend conecta como dueño de las tablas → RLS no lo afecta.
  REGLA: toda tabla O VISTA nueva nace cerrada (las vistas NO están en
  pg_tables — revocar aparte y con security_invoker); si algún día se quiere
  acceso directo vía supabase-js, política RLS explícita en migración.
- Aplicaciones SIEMPRE agregadas por documento antes de validar saldo
  (recibos→facturas, pagos→compras, devoluciones→líneas): repetir un id en la
  petición se suma, jamás sobreaplica.
- Inmutabilidad BD TOTAL (comparación jsonb) en TODOS los documentos
  (facturas, compras, recibos, notas, movimientos_banco, traslados): solo la
  transición a anulado (+conciliado en bancos), ningún otro campo se toca;
  líneas/aplicaciones solo se insertan en la MISMA transacción que crea su
  documento (creado_en = now()).
- Bodega OBLIGATORIA al emitir factura con productos (sin fallback implícito),
  revalidada al emitir contra la sucursal de la serie.
- USD bloqueado en bancos hasta implementar multimoneda completa.
- Bootstrap del primer admin: atómico con pg_advisory_xact_lock.
- HTTP: CORS_ORIGEN OBLIGATORIO en producción (el server no arranca sin él);
  rate limit por IP (RATE_LIMIT/min, default 300); cabeceras nosniff/DENY/
  no-referrer; json limit 8mb (la apertura trae miles de líneas); timeout 10s validando tokens; PG_POOL_MAX
  validado (1-50). Bundle dividido (vendor chunk).
- Suite contable automatizada: `npm test` (Vitest + supertest) — corre contra
  un ESQUEMA TEMPORAL en el mismo Supabase (pruebas_<ts>): aplica las 15
  migraciones desde cero (prueba de reproducibilidad), ejecuta el ciclo
  completo por API (compra→promedio→factura con IVA/costo→sobrecobros
  rechazados→devoluciones→cheque→anulación espejo), verifica triggers por SQL
  directo (cuadre, período cerrado, inmutabilidad, no-DELETE) y el perímetro
  RLS vía REST (401). Destruye el esquema al final — la base real no se toca.
  El bypass de auth de la suite SOLO se activa con ESQUEMA_PRUEBAS definido y
  nunca en producción (auth.ts); la cabecera `x-prueba-usuario` (solo bajo ese
  mismo doble candado) simula usuarios no-admin con amarres para probar el
  enforcement. Las cuentas de login que la suite crea en auth.users (esquema
  compartido, dominio @pruebas-sevasa.local) se limpian en el afterAll.
  CORRE ANTES DE CADA PUSH.
- Pendiente de la auditoría: columnas de auditoría en tablas menores.

## Capacidad y concurrencia

- Consecutivos PROBADOS bajo carga: `npm run prueba:carga` — 20 clientes × 25
  emisiones contra una serie: 0 duplicados, 0 huecos, último número exacto.
- FLUJO COMPLETO bajo concurrencia (en la suite): 20 vendedores emitiendo
  facturas reales A LA VEZ (borrador→emitir con asiento+kardex) — verifica
  0 duplicados, 0 huecos, existencia descontada EXACTA y todos los asientos
  cuadrados.
- Pool pg: max 10 (PG_POOL_MAX), idle 30s, connect timeout 20s. El timeout
  era 10s y una ráfaga de 20 emisiones agotaba el pool: algunas morían con
  "Error interno". Ahora hacen COLA (se despachan en un par de segundos) y
  si aun así se satura, el error middleware responde 503 con mensaje claro
  ("el sistema está ocupado… no se grabó nada"), nunca un 500 mudo.
- Listados de volumen con paginación servidor: facturas (q + fechas + pagina/
  por_pagina, respuesta {facturas, total}) y productos (?pagina= activa el modo
  {productos, total}; sin ?pagina= responde el array plano para los selectores
  existentes; GET /productos/:id/existencias = detalle por bodega). Replicar el
  patrón en compras/recibos cuando crezcan.

## Deploy (Vercel — EN PRODUCCIÓN)

- `api/index.ts` exporta la app de Express como función serverless; `vercel.json`
  reenvía `/api/*` a la función y el resto a `index.html` (SPA). El
  `package.json` de la raíz trae las dependencias runtime de la función.
- Variables de entorno requeridas en Vercel:
  `DATABASE_URL` (pooler :6543) · `SUPABASE_URL` · `SUPABASE_ANON_KEY` ·
  `CORS_ORIGEN` (OBLIGATORIA: dominio del deploy — sin ella el server no
  arranca en producción) · `PG_POOL_MAX=3` (serverless: muchas instancias
  chicas) · `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (build del front).
- El deploy es automático al hacer push a main (previo `npm test` SIEMPRE).
  Supabase Pro y Vercel Pro activos; recomendado activar PITR en Supabase.
- La salida operativa definitiva sigue el paralelo de 1-2 meses del plan (§F7):
  FASE ACTUAL — falta la primera factura real de prueba (emitir → verificar
  asiento con costo → anular) e inicializar el "último número" de las series
  A-SUR / A-OCC / A-CM donde quedó el consecutivo viejo (A-CEN ya está en 1500).

## Comandos

```
cd backend && npm run dev        # backend en :3001
cd backend && npm run migrate    # aplicar migraciones pendientes
cd backend && npm run seed       # datos de prueba (solo con la base vacía)
cd backend && npm run typecheck
cd backend && npm test             # suite contable contra esquema temporal (~30s)
cd app && npm run dev            # frontend en :5173 (proxy /api → :3001)
cd app && npm run build          # typecheck + build
```

## Estado actual (resumen por módulo)

| Módulo | Estado | Notas |
|---|---|---|
| F0 infraestructura | ✅ | Supabase Pro + Auth + runner de migraciones + Vercel Pro EN PRODUCCIÓN (deploy automático desde main) + Docker preparado (sin probar) |
| F1 núcleo contable | ✅ | Cuentas, períodos, asientos manuales, balanza, mayor (API + pantallas) |
| F1 importador ✅ | ✅ | Contabilidad → Saldos iniciales (`rutas/apertura.ts`). CONVERTIDOR de la balanza detallada del sistema viejo (detalle.xls, POST /apertura/convertir-detalle): clasifica grupo 1-1-4→clientes, subárbol 2-1-1-1→proveedores, INVENTARIOS→cuenta global 1-1-3, resto→CREA el catálogo con el código viejo en guiones (+encabezados de grupo) y apunta config cxc/cxp/inventario a los enlaces 1-1-4/2-1-1-1/1-1-3; residuos y filas corruptas → cuenta de ajuste 3-99. EXISTENCIAS (POST /apertura/convertir-existencias): sube el reporte del sistema viejo (CODIGO_DETALLE/COSTO/columnas por ubicación), panel de MAPEO columna→bodega (varias columnas suman a una), CREA los productos (nombre/categoría/precio=US$×TC opcional), descarta los 0.000001, arma la hoja de kardex y RECALCULA 1-1-3 + 3-99 en la balanza (el kardex manda). Plantilla Excel descargable pre-llenada con el catálogo (5 hojas, SheetJS 0.20.3 del CDN oficial — el de npm está vulnerable) y subida de plantilla llena. También: se pegan 4 hojas desde Excel (balanza / cartera clientes / proveedores / inventario), validación en vivo SIN grabar (cuadre al centavo; cartera=CxC, proveedores=CxP, inventario=cuenta Inventario), carga en UNA tx: asiento único tipo 'apertura' + facturas de apertura serie INI por cliente (auxiliares SIN asiento — los recibos se aplican hasta cero) + compras INI por proveedor (pagables en Bancos) + kardex `ajuste_entrada` origen 'apertura' (fija promedio). Anular = contra-asiento + reversas (bloqueado si hay cobros/pagos encima). Terceros faltantes se crean opcionalmente; productos deben existir. Zona de peligro "LIMPIAR PRUEBAS": TRUNCATE de todas las transacciones (catálogos, usuarios y bitácora intactos; consecutivos/promedios/períodos reiniciados; queda en bitácora) — para pasar de pruebas a carga real |
| F2 facturación | ✅ | Borrador → emitir (row-lock + asiento) → anular. Vendedor opcional |
| F2 facturas manuales | ✅ | Series tipo 'manual' por sucursal (sin talonarios); el nº del papel se digita al grabar; papel dañado → anulada sin cliente/montos; control de huecos por serie en Configuración |
| F2 CxC | ✅ | Recibos con aplicaciones, notas de crédito (devolución/rebaja), cartera con antigüedad |
| Inventario + compras | ✅ | Kardex, costo promedio, OC → compra → CxP; costo de venta automático |
| Configuración | ✅ | Sucursales (con cuenta de caja propia), bodegas, vendedores (amarrados a tienda), series (número inicial / talonario desde-Nº), parámetros, clientes, proveedores, productos. Bodegas/sucursales/series SIN historia se pueden BORRAR (FK protege; serie INI y las de config intocables); con historia solo se desactivan. Tipo de cambio BCN: GET/POST /api/config/tipo-cambio (tabla tipos_cambio, editable desde Productos); Productos muestra costo US$ = costo C$ / tasa vigente |
| Usuarios ✅ | ✅ | Administración → Usuarios: alta completa (login+ficha+roles) en una tx, edición, desactivar (nunca borrar), reset de clave; amarres sucursal/bodega/vendedor con enforcement duro en facturas (series) y traslados (origen). Foto: diferida |
| Traslados | ✅ | Entre bodegas, sin asiento (solo kardex doble al promedio); exige existencia en origen; anulación regresa la mercadería. Flujo: se recibe en bodega central → traslado a tiendas. Filtro parametrizable: al facturar solo se ven productos con existencia en la bodega de la tienda (`ventas_filtrar_por_bodega`) |
| F2 pendiente | ⏳ | Impresión formato DGI (DECISIÓN: se deja de ÚLTIMO, es maquillaje), restyle pantallas F1 |
| F3 bancos/cheques ✅ | ✅ | Cuentas bancarias (chequera con último cheque inicializable), cheques/transferencias/depósitos/débitos-créditos bancarios con asiento automático, pago a proveedores aplicado a compras (baja CxP con validación de saldo), anulación por contra-asiento, conciliación manual con flotante. Pendiente F3b: importar estado de cuenta, multimoneda USD plena, impresión de cheque |
| F4 retenciones ✅ | ✅ | Tipos configurables (tasa/base/cuenta/aplica); retención EFECTUADA en la compra (acredita su cuenta, baja CxP al neto — SQL_SALDOS_CXP ya resta retenciones); RECIBIDA en recibo (disponible, SEVASA exento por gran contribuyente); reporte DGI efectuadas/recibidas por tercero. compra_retenciones/recibo_retenciones INSERT-only |
| F5 pólizas ✅ | ✅ | Importación: prorrateo de gastos (flete/seguro/DAI/ISC/agencia) al costo por valor/peso/unidades con reparto de centavos exacto; IVA de importación aparte (acreditable); liquidar → asiento de nacionalización + entrada al inventario a costo puesto en bodega (kardex entrada_poliza + promedio); anular espejo. Jalar OCs (multi, quedan recibidas al liquidar) y MULTIPÓLIZA: cada línea con su proveedor, FOB acreditado a la CxP de cada uno. Motor puro en `polizas-calculo.ts`, preview en vivo vía POST /polizas/calcular |
| F6 estados financieros ✅ | ✅ | Balance General (utilidad del período sin cerrar cierra la ecuación; badge de cuadre A=P+C), Estado de Resultados por rango con comparativo automático del período anterior + KPIs (utilidad bruta/neta, margen), cierre del ejercicio (asiento tipo 'cierre' salda ingresos/costos/gastos contra `cuenta_resultados_acumulados`, doble confirmación, permiso cerrar). Rutas /estados/balance y /estados/resultados |

| F7 paralelo | ⏳ | FASE ACTUAL: apertura real cargada (2026-06-30); falta factura de prueba E2E, inicializar consecutivos de A-SUR/A-OCC/A-CM y correr 1-2 meses en paralelo con el sistema viejo antes del corte |

Decisiones clave registradas en el plan: inventario perpetuo con costo promedio (§F2),
saldos iniciales por saldo global por tercero (§F1), multimoneda NIO/USD desde el día 1.
Enlaces reales decididos (2026-07-24): ventas→4-01 (todas las ventas nuevas a una sola
cuenta; las ventas-por-cliente del sistema viejo quedan como historia), IVA→2-1-1-4-53,
IVA acreditable→1-3-1-1-02, costo→5-03-01-01, resultados acumulados→3-09-02-02,
caja general→1-01-01 (respaldo; cada sucursal usa su caja automática propia).
