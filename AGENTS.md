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
- Existencia negativa: permitida (avisa en rojo en Productos), no bloquea la venta.

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

## Comandos

```
cd backend && npm run dev        # backend en :3001
cd backend && npm run migrate    # aplicar migraciones pendientes
cd backend && npm run seed       # datos de prueba (solo con la base vacía)
cd backend && npm run typecheck
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
| F3 bancos/cheques | ⏳ | Incluirá pago a proveedores (CxP) y conciliación |
| F4 retenciones | ⏳ | 2% efectuadas/recibidas |
| F5 pólizas | ⏳ | `entrada_poliza` ya prevista en kardex; prorrateo CIF+DAI |
| F6 estados financieros | ⏳ | Balance, resultados, cierre — reusar diseño Finanzas Sevasa |

Decisiones clave registradas en el plan: inventario perpetuo con costo promedio (§F2),
saldos iniciales por saldo global por tercero (§F1), multimoneda NIO/USD desde el día 1.
