# SEVASA Contable — guía del proyecto

Sistema contable-financiero oficial de la empresa (Nicaragua): facturación, CxC, inventario,
compras/CxP, bancos, cheques, pólizas de importación, partida doble y estados financieros.
30 usuarios. El plan maestro vive en `PLAN_SISTEMA_CONTABLE.md` (raíz del repo).

Infraestructura: Supabase "sevasa" (`dqlylcjwvcbxyxsoyhnw`, us-east-2) + Vercel (pendiente).
Auth: Supabase Auth; el PRIMER usuario que entra queda como admin (bootstrap en `auth.ts`).

## Principio rector

El usuario registra DOCUMENTOS (factura, recibo, nota, compra, cheque, póliza); el sistema
genera los ASIENTOS automáticamente. Nadie escribe partida doble a mano salvo ajustes
autorizados (rol contador).

## Arquitectura

- `app/` — React 18 + Vite + TypeScript + Tailwind 4
- `backend/` — Node + Express 4 + TypeScript estricto (un `undefined` silencioso puede
  descuadrar un asiento; TS lo atrapa en compilación)
- `migrations/` — SQL numeradas `001_...` a `008_...` — TODO el esquema versionado
- `docker/` — docker-compose para portabilidad futura; hoy NO hay Docker en esta máquina:
  se desarrolla contra Supabase directo
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
Módulos en uso: `contabilidad`, `facturacion`, `compras`, `cxc`, `admin`.
El rol `admin` pasa todo (bypass en `requierePermiso`). Roles: admin, contador, cajero,
facturador, comprador, consulta.

## Diseño (sistema "libro mayor moderno")

- Tokens en `app/src/index.css` (@theme): tinta/fondo/verde/borde/ámbar/rojo.
  Fuentes: Schibsted Grotesk (UI) + IBM Plex Mono (cifras, clase `.cifra`).
- Clases obligatorias para TODA pantalla nueva (no estilos ad-hoc):
  `.entrada`, `.etiqueta`, `.boton-primario/.boton-suave/.boton-peligro`, `.tarjeta`,
  `.insignia-verde/-ambar/-roja/-gris`, `.tabla`, `.cifra`.
- Shell: sidebar tinta con grupos (Ventas / Compras / Contabilidad / Administración).
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
  no-referrer; json limit 1mb; timeout 10s validando tokens; PG_POOL_MAX
  validado (1-50). Bundle dividido (vendor chunk).
- Suite contable automatizada: `npm test` (Vitest + supertest) — corre contra
  un ESQUEMA TEMPORAL en el mismo Supabase (pruebas_<ts>): aplica las 15
  migraciones desde cero (prueba de reproducibilidad), ejecuta el ciclo
  completo por API (compra→promedio→factura con IVA/costo→sobrecobros
  rechazados→devoluciones→cheque→anulación espejo), verifica triggers por SQL
  directo (cuadre, período cerrado, inmutabilidad, no-DELETE) y el perímetro
  RLS vía REST (401). Destruye el esquema al final — la base real no se toca.
  El bypass de auth de la suite SOLO se activa con ESQUEMA_PRUEBAS definido y
  nunca en producción (auth.ts). CORRE ANTES DE CADA PUSH.
- Pendiente de la auditoría: columnas de auditoría en tablas menores.

## Capacidad y concurrencia

- Consecutivos PROBADOS bajo carga: `npm run prueba:carga` — 20 clientes × 25
  emisiones contra una serie: 0 duplicados, 0 huecos, último número exacto.
- Pool pg: max 10 (PG_POOL_MAX), idle 30s, connect timeout 10s — el pooler de
  Supabase multiplexa por transacción.
- Listados de volumen con paginación servidor: facturas (q + fechas + pagina/
  por_pagina, respuesta {facturas, total}). Replicar el patrón en compras/
  recibos cuando crezcan.

## Deploy (Vercel — preparado, AÚN NO PUBLICADO)

- `api/index.ts` exporta la app de Express como función serverless; `vercel.json`
  reenvía `/api/*` a la función y el resto a `index.html` (SPA). El
  `package.json` de la raíz trae las dependencias runtime de la función.
- Variables de entorno requeridas en Vercel:
  `DATABASE_URL` (pooler :6543) · `SUPABASE_URL` · `SUPABASE_ANON_KEY` ·
  `CORS_ORIGEN` (OBLIGATORIA: dominio del deploy — sin ella el server no
  arranca en producción) · `PG_POOL_MAX=3` (serverless: muchas instancias
  chicas) · `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (build del front).
- Flujo: `vercel login` → `vercel link` → cargar variables → `vercel`
  (preview = staging privado con protección de acceso) → probar E2E →
  `vercel --prod` SOLO cuando el usuario lo ordene.
- La salida operativa definitiva sigue el paralelo de 1-2 meses del plan (§F7).

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
| F0 infraestructura | ✅ | Supabase + Auth + runner de migraciones. Falta deploy Vercel |
| F1 núcleo contable | ✅ | Cuentas, períodos, asientos manuales, balanza, mayor (API + pantallas) |
| F1 importador | ⏳ | Espera catálogo y balanza del sistema viejo en `datos-prueba/` — criterio: cuadre al centavo |
| F2 facturación | ✅ | Borrador → emitir (row-lock + asiento) → anular. Vendedor opcional |
| F2 facturas manuales | ✅ | Series tipo 'manual' por sucursal (sin talonarios); el nº del papel se digita al grabar; papel dañado → anulada sin cliente/montos; control de huecos por serie en Configuración |
| F2 CxC | ✅ | Recibos con aplicaciones, notas de crédito (devolución/rebaja), cartera con antigüedad |
| Inventario + compras | ✅ | Kardex, costo promedio, OC → compra → CxP; costo de venta automático |
| Configuración | ✅ | Sucursales (con cuenta de caja propia), bodegas, vendedores (amarrados a tienda), series (número inicial / talonario desde-Nº), parámetros, clientes, proveedores, productos |
| Traslados | ✅ | Entre bodegas, sin asiento (solo kardex doble al promedio); exige existencia en origen; anulación regresa la mercadería. Flujo: se recibe en bodega central → traslado a tiendas. Filtro parametrizable: al facturar solo se ven productos con existencia en la bodega de la tienda (`ventas_filtrar_por_bodega`) |
| F2 pendiente | ⏳ | Impresión formato DGI (DECISIÓN: se deja de ÚLTIMO, es maquillaje), restyle pantallas F1 |
| F3 bancos/cheques ✅ | ✅ | Cuentas bancarias (chequera con último cheque inicializable), cheques/transferencias/depósitos/débitos-créditos bancarios con asiento automático, pago a proveedores aplicado a compras (baja CxP con validación de saldo), anulación por contra-asiento, conciliación manual con flotante. Pendiente F3b: importar estado de cuenta, multimoneda USD plena, impresión de cheque |
| F4 retenciones ✅ | ✅ | Tipos configurables (tasa/base/cuenta/aplica); retención EFECTUADA en la compra (acredita su cuenta, baja CxP al neto — SQL_SALDOS_CXP ya resta retenciones); RECIBIDA en recibo (disponible, SEVASA exento por gran contribuyente); reporte DGI efectuadas/recibidas por tercero. compra_retenciones/recibo_retenciones INSERT-only |
| F5 pólizas ✅ | ✅ | Importación: prorrateo de gastos (flete/seguro/DAI/ISC/agencia) al costo por valor/peso/unidades con reparto de centavos exacto; IVA de importación aparte (acreditable); liquidar → asiento de nacionalización + entrada al inventario a costo puesto en bodega (kardex entrada_poliza + promedio); anular espejo. Jalar OCs (multi, quedan recibidas al liquidar) y MULTIPÓLIZA: cada línea con su proveedor, FOB acreditado a la CxP de cada uno. Motor puro en `polizas-calculo.ts`, preview en vivo vía POST /polizas/calcular |
| F6 estados financieros | ⏳ | Balance, resultados, cierre — reusar diseño Finanzas Sevasa |

Decisiones clave registradas en el plan: inventario perpetuo con costo promedio (§F2),
saldos iniciales por saldo global por tercero (§F1), multimoneda NIO/USD desde el día 1.
