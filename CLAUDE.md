# SEVASA Contable — guía del proyecto

Sistema contable-financiero oficial de la empresa (Nicaragua): facturación, CxC, bancos,
cheques, compras/CxP, pólizas de importación, partida doble y estados financieros.
30 usuarios. El plan maestro vive en `PLAN_SISTEMA_CONTABLE.md` (raíz del repo).

## Principio rector

El usuario registra DOCUMENTOS (factura, cheque, compra, póliza); el sistema genera los
ASIENTOS automáticamente. Nadie escribe partida doble a mano salvo ajustes autorizados
(rol contador).

## Arquitectura

- `app/` — React 18 + Vite + TypeScript + Tailwind 4
- `backend/` — Node + Express 4 + TypeScript estricto (un `undefined` silencioso puede
  descuadrar un asiento; TS lo atrapa en compilación)
- `migrations/` — SQL numeradas `001_...`, `002_...` — TODO el esquema versionado
- `docker/` — docker-compose para portabilidad futura (VPS/local); hoy NO hay Docker
  en esta máquina: se desarrolla contra Supabase directo
- Producción: Vercel (frontend + api) + Supabase Postgres (proyecto NUEVO, separado del BI)

## Reglas duras de la BD (ya implementadas en 001 — NO relajarlas)

1. Asiento descuadrado = imposible: constraint trigger DIFERIDO al commit
   (`trg_verificar_cuadre`). Insertar movimientos y asiento en UNA transacción.
2. Período cerrado = inmutable a nivel BD (`trg_proteger_asiento` / `trg_proteger_movimiento`).
3. Nada se borra: asientos se ANULAN con contra-asiento (`anulado`, `anulado_por`).
   La balanza (`v_balanza`) incluye TODOS los asientos: original + contra se netean.
4. Solo cuentas de detalle (`es_detalle`) activas reciben movimientos.
5. Multimoneda: montos SIEMPRE en NIO; si el documento es USD van `moneda`,
   `tipo_cambio` (tabla `tipos_cambio`, oficial BCN) y `monto_origen`.
6. Auditoría en toda tabla: `creado_por/en`, `actualizado_por/en`. Acciones sensibles
   (anular, cerrar, cambiar catálogo/config) → registrar en `bitacora`.

## Consecutivos (facturas, recibos, cheques, notas, pólizas)

- Número tomado DENTRO de la transacción de emisión con row-lock:
  `UPDATE series SET ultimo_numero = ultimo_numero + 1 WHERE serie = $1 RETURNING ultimo_numero`
- NUNCA secuencias de Postgres (huecos en rollback) ni "leer último + 1" en la app.
- Documento nace BORRADOR sin número; el número se asigna al EMITIR. Emitido = inmutable.
- Anulación conserva el número (la DGI exige consecutivo completo). Jamás se reciclan.

## Convenciones de trabajo

- **NO push sin orden explícita del usuario.**
- Todo en español: tablas, columnas, código, mensajes, commits.
- Logs con emoji: ✅ éxito, ❌ error, ✨ resumen, 🚀 arranque.
- Migraciones: NUNCA DDL suelto pegado a mano (ni vía Supabase MCP) — siempre archivo
  numerado nuevo + `npm run migrate`. Las migraciones aplicadas no se editan.
- Config en tablas de BD, no en código: tasas (IVA 15%, retenciones, DAI), series,
  formatos de cheque. Cada cambio de config queda en `bitacora`.
- Escrituras contables SIEMPRE vía `enTransaccion()` (`backend/src/db.ts`).
- Tests de cuadre (Jest, pendiente F1): asiento descuadrado imposible, balanza suma cero,
  IVA correcto, período cerrado rechaza escritura. Corren antes de cada push.
- Fases chicas probadas E2E con datos reales antes de avanzar (método Sevasa).

## Comandos

```
cd backend && npm run dev        # backend en :3001
cd backend && npm run migrate    # aplicar migraciones pendientes
cd backend && npm run typecheck
cd app && npm run dev            # frontend en :5173 (proxy /api → :3001)
cd app && npm run build
```

## Estado actual

- F0 en curso: falta crear proyecto Supabase (espera confirmación de costo del usuario),
  conectar Supabase Auth al login y desplegar en Vercel.
- Datos de prueba del sistema viejo: se cargan en `datos-prueba/` (raíz del repo,
  EXCLUIDA de git — datos reales de la empresa no van al historial).
- Saldos iniciales: carga simplificada por saldos globales por tercero (ver plan §F1).