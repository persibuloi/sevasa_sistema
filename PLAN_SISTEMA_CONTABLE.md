# Plan — Sistema Contable-Financiero Propio (SEVASA Contable)

> Fecha: julio 2026 · Estado: PLAN APROBADO — se ejecutará en OTRA carpeta/repo/Vercel/proyecto Supabase
> Decisiones del usuario: **reemplaza al sistema contable actual** · **nube (Supabase + Vercel)** ·
> **prioridad #1 tras el núcleo: Facturación y CxC** · **usuarios en Supabase Auth** (control a nivel de BD, ver §4)

## 1. Visión

Un sistema contable-financiero a la medida, para **30 usuarios**, que será LA contabilidad oficial de la empresa:
facturación, CxC, bancos, cheques, compras, obligaciones (CxP), liquidación de pólizas de importación,
contabilidad de partida doble y estados financieros. De aquí saldrán la balanza, los estados y los insumos
para las declaraciones DGI (hoy eso vive en un sistema externo cuya balanza se importa a Sevasa→Finanzas).

**Principio rector (lección de Sevasa):** el usuario registra DOCUMENTOS (factura, cheque, compra, póliza);
el sistema genera los ASIENTOS automáticamente. Nadie escribe partida doble a mano salvo ajustes autorizados.

## 2. Arquitectura

```
Repo NUEVO (monorepo, mismo layout que Sevasa):
  app/       React 18 + Vite + TypeScript + Tailwind   (lo que ya dominamos)
  backend/   Node + Express + **TypeScript**            (mejora vs Sevasa: tipado estricto — en un
                                                         sistema contable un undefined silencioso
                                                         puede descuadrar un asiento; TS lo atrapa
                                                         en compilación. Mismo Express de siempre.)
  migrations/  SQL numeradas 001_..., 002_...           (TODO el esquema versionado — no scripts sueltos)
  docker/    docker-compose.yml (Postgres+backend+app)  (portabilidad futura a VPS/local sin tocar código)

Producción:  Vercel (frontend + api serverless) + Supabase Postgres (proyecto NUEVO, separado del BI)
```

- **Postgres para TODO. Cero Airtable.** (Lección: límites de registros, campos frágiles, sin transacciones.)
- Proyecto Supabase **separado** del de Análisis de Ventas: la contabilidad oficial no comparte base con el BI.
- Toda escritura contable dentro de **transacciones** (asiento + movimientos + documento = una sola transacción).
- 30 usuarios es carga trivial para Postgres/Vercel; el reto no es rendimiento, es **integridad y permisos**.

## 3. Núcleo de datos (partida doble)

```sql
cuentas        (codigo PK, nombre, tipo: activo/pasivo/capital/ingreso/costo/gasto, padre, nivel, activa)
periodos       (ano_mes PK, estado: abierto/cerrado, cerrado_por, cerrado_en)
asientos       (id, fecha, ano_mes, tipo_origen, origen_id, concepto, creado_por, anulado)
movimientos    (asiento_id, cuenta, debito, credito, tercero_id?, documento_ref?)
   CONSTRAINT: por asiento, SUM(debito) = SUM(credito)  -- verificado por trigger + test
terceros       (clientes y proveedores unificados: RUC/cédula, nombre, tipo, términos)
```

Reglas duras:
1. Asiento descuadrado = imposible de guardar (trigger + validación app).
2. Período cerrado = inmutable (patrón snapshot que ya usamos en planilla/comisiones, aquí a nivel BD).
3. Nada se borra: se **anula** con contra-asiento (auditoría total: quién, cuándo, por qué).
4. Toda tabla lleva `creado_por`, `creado_en`, `actualizado_por`, `actualizado_en`.

## 4. Usuarios y permisos (30 personas)

**DECIDIDO (usuario):** cuentas propias con **Supabase Auth** (email+contraseña, MFA opcional para contabilidad),
independientes de Sevasa/Firebase/Airtable. Ventaja clave: el control de acceso llega hasta la base de datos —
**RLS (Row Level Security) por usuario/rol directamente en Postgres**, no solo en el backend. La contabilidad
oficial no depende del grafo de roles en Airtable (frágil, sin FK). Roles y permisos en Postgres:

```sql
usuarios       (id, email, nombre, activo)
roles          (admin, contador, cajero, facturador, comprador, consulta, ...)
permisos       (rol → módulo → accion: ver/crear/editar/anular/cerrar)
```

- Permisos por ACCIÓN, no solo por vista (ej.: un cajero emite cheques pero no puede anularlos).
- Bitácora de acciones sensibles (anulaciones, cierres, cambios de catálogo) desde el día 1.
- Si luego se quiere "un solo login" con Sevasa, se agrega SSO por Google — decisión reversible.

## 5. Fases (cada una se entrega, se prueba E2E y se pushea — método Sevasa)

### F0 — Infraestructura (≈1 semana)
Repo + CLAUDE.md del proyecto + proyecto Supabase + Vercel + migraciones 001 (núcleo §3) +
auth + roles + layout base de la app. **Criterio:** login funciona, migraciones reproducibles de cero.

**Panel de administración: cimientos en F0, contenido por fase (DECIDIDO).**
NO se construye un gran panel de configuración por adelantado (se adivina mal, estanca el proyecto
y no se puede probar sin módulos que lo usen). En F0 solo los cimientos que todos comparten:
usuarios/roles/permisos, la sección "Administración" del menú (contenedor), el patrón único de
tablas de config editables en pantalla (nada quemado en código), y la bitácora de cambios de
configuración (quién cambió qué tasa y cuándo — obligatorio en contabilidad). Luego cada fase
cuelga su propia config al nacer su módulo: F1 catálogo/períodos, F2 series/talonarios/IVA,
F3 bancos/formatos de cheque, F4 retenciones, etc. (patrón probado en Análisis de Ventas).

### F1 — Núcleo contable (≈2-3 semanas)
Catálogo de cuentas (importado del actual vía Excel), períodos, asientos manuales (solo rol contador),
balanza de comprobación en vivo, libro mayor por cuenta. Carga de **saldos iniciales**.
**Criterio:** la balanza cuadra al centavo con la del sistema viejo a la fecha de corte.

**Saldos iniciales — carga simplificada por saldos (DECIDIDO):**
1. CxC/CxP: se carga **un documento "SALDO DE APERTURA" por tercero** con su saldo global a la fecha
   de corte (ej.: Juan Pérez C$100,000, aunque sean 3 facturas). Cobros/pagos se aplican contra ese
   documento hasta llegar a cero; de ahí en adelante todo es documento nuevo con detalle completo.
2. El detalle histórico NO se migra: el sistema viejo queda como **archivo de solo consulta** (≥1 año).
3. Antigüedad de cartera: los saldos de apertura van a un bucket "Apertura" (sin edad por factura);
   el reporte se vuelve 100% real solo conforme rota la cartera. Opcional: cargar detalle factura por
   factura únicamente para clientes grandes/morosos donde la edad importe.
4. **Excepción obligatoria:** los cheques flotantes (emitidos y no cobrados al corte) se cargan uno
   por uno (número, beneficiario, monto) — sin esa lista la primera conciliación de F3 no cierra.
5. Validación: suma de saldos por tercero == saldo de la cuenta en balanza, al centavo.
6. Insumos requeridos: saldos por cliente y por proveedor a la fecha de corte (export simple:
   tercero, saldo) — ya no se necesita el auxiliar documento por documento.

### F2 — Facturación y CxC (≈3-4 semanas) ← PRIORIDAD DEL USUARIO
Clientes, series de factura por tienda, factura (contado/crédito) → asiento automático (CxC/Caja vs
Ventas + IVA 15%), recibos de cobro, notas de crédito, antigüedad de cartera, retenciones recibidas.
**Definir aquí:** requisitos de facturación DGI vigentes (¿facturación electrónica? formato de pie legal).
**Criterio:** un día completo de ventas reales facturado en paralelo cuadra contra el sistema viejo.

**Consecutivo con 20-30 usuarios concurrentes (diseño obligatorio):**
```sql
series (serie PK, tienda, prefijo, ultimo_numero)
-- El número se toma DENTRO de la transacción de emisión, con bloqueo de fila:
UPDATE series SET ultimo_numero = ultimo_numero + 1 WHERE serie = $1 RETURNING ultimo_numero;
```
1. El UPDATE con row-lock serializa la entrega de números → imposible duplicar (dos usuarios
   simultáneos: el segundo espera milisegundos). NO usar secuencias de Postgres (dejan huecos en
   rollback) ni "leer último + 1" en la app (duplica bajo concurrencia).
2. Número + factura + asiento en UNA transacción: si algo falla, se revierte todo → sin huecos.
3. Una serie por tienda → la contención se reparte; 20 usuarios es carga trivial.
4. La factura nace BORRADOR (sin número); el número se asigna solo al EMITIR (borradores
   abandonados no queman números). Emitida = inmutable.
5. Anulación conserva el número (contra-asiento + estado "anulada") — la DGI exige el consecutivo
   completo, anuladas incluidas. Los números jamás se reciclan.
6. Mismo patrón para TODOS los consecutivos: recibos de cobro, cheques, notas de crédito, pólizas.

**Facturas MANUALES (contingencia sin internet) — 4 sucursales:**
Cada sucursal tiene DOS series: sistema (`A-ALT`…) y manual (`M-ALT`…, talonarios de papel preimpresos).
```sql
series.tipo = 'sistema' | 'manual'
talonarios (id, serie_manual, rango_desde, rango_hasta, sucursal, estado)
```
1. Sin internet la tienda factura del talonario; al volver la conexión se GRABAN en el sistema
   digitando el número del papel (pantalla "Grabar factura manual", fecha real del documento).
2. Validaciones al grabar: el número pertenece a un talonario de ESA sucursal; no usado antes
   (duplicado imposible); dentro de período abierto.
3. Huecos: el sistema AVISA pero no bloquea — una factura de papel dañada se graba como ANULADA
   con su número, para que el consecutivo quede completo ante la DGI.
4. Pantalla "Control de talonarios": por sucursal, números usados/anulados/pendientes y huecos
   sin justificar (para que contabilidad persiga el papel no grabado).
5. Contablemente idénticas a las de sistema (mismo asiento automático), marcadas origen='manual'.

### F3 — Bancos y cheques (≈2-3 semanas)
Cuentas bancarias, emisión/impresión de cheques (formato de cada banco), transferencias, depósitos,
conciliación bancaria (importar estado de cuenta → matching), flotante de cheques no cobrados.
**Criterio:** conciliar un mes real de una cuenta BAC/Lafise completa.

### F4 — Compras y obligaciones CxP (≈2-3 semanas)
Proveedores, factura de compra → asiento (Inventario/Gasto vs CxP), retenciones efectuadas (2%, etc.),
programación de pagos, antigüedad de CxP, pago vía F3 (cheque/transferencia).

### F5 — Liquidación de pólizas (≈2 semanas)
Póliza: FOB + flete + seguro (CIF) + DAI + ISC/IVA + agencia + transporte → prorrateo al costo unitario
por producto (por valor/peso/unidades, configurable). Asiento de nacionalización. Reporte de liquidación
con el formato que hoy usa la empresa.

### F6 — Estados financieros y cierre (≈2 semanas)
Balance General, Estado de Resultados, comparativos e interanual — **reusamos el diseño del módulo
Finanzas de Sevasa** (que ya cuadra con la DGI), pero leyendo asientos propios en vez de balanza importada.
Cierre anual, IR anual (form 106 — know-how ya probado). Export de balanza para transición.

### F7 — Corte y salida a producción (≈1 mes en paralelo)
Aunque el sistema reemplaza todo, se corre **1-2 meses en paralelo** con el sistema viejo:
mismas operaciones en ambos, comparando balanza mes a mes. El corte solo se da con 2 meses cuadrados.

**Total estimado: ~4-6 meses** al ritmo de trabajo que llevamos en Sevasa (fases chicas, E2E, push).

## 6. Metodología vibe coding (lecciones aplicadas de Sevasa)

1. `CLAUDE.md` desde el día 1: convenciones, gotchas, "no push sin orden", emoji-logs, checklist de vista nueva.
2. Migraciones SQL numeradas y `npm run migrate` — nunca DDL suelto pegado a mano (lección Supabase-MCP).
3. **Tests de cuadre automáticos** (Jest): asiento descuadrado imposible, balanza suma cero, IVA de factura
   correcto, período cerrado rechaza escritura. Corren antes de cada push.
4. Config en tablas, no en código: tasas (IVA, retenciones, DAI), series, formatos de cheque, catálogo.
5. Cierres con snapshot + candado (patrón ya probado en planilla/metas/comisiones).
6. Fases pequeñas probadas E2E con datos reales antes de avanzar (patrón bono bodega).

## 7. Costos mensuales estimados

| Concepto | Costo |
|---|---|
| Supabase Pro (proyecto nuevo, respaldos diarios 7d) | $25/mes |
| Vercel (hobby alcanza al inicio; Pro si hace falta) | $0-20/mes |
| Dominio/SSL | ~$1/mes |
| **Total** | **~$25-45/mes** (vs $200-300/mes de Odoo Enterprise para 10-15 usuarios; aquí 30 sin costo por usuario) |

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Saldos iniciales mal migrados | F1 exige cuadre al centavo contra sistema viejo antes de seguir |
| Facturación electrónica DGI (si es obligatoria) | Investigar requisito vigente en F2 ANTES de construir la factura |
| "Big bang" fallido | F7: paralelo 1-2 meses, corte solo con 2 meses cuadrados |
| Usuarios resistentes al cambio (30 personas) | Involucrar a contabilidad desde F1; capacitar por módulo, no al final |
| Dependencia de una sola persona (vos) | Todo documentado en el repo; migraciones reproducibles; respaldos automáticos |

## 9. Primer paso concreto (cuando el usuario dé luz verde)

1. Crear repo nuevo (`sevasa-contable` o el nombre que elija).
2. Crear proyecto Supabase nuevo (región us-east, Pro).
3. F0 completa en la primera semana.
4. Pedir al usuario: catálogo de cuentas actual (Excel), un estado de cuenta bancario de ejemplo,
   una factura y una liquidación de póliza reales — son los moldes de F1-F5.
