# SEVASA Contable

Sistema contable-financiero propio: facturación, CxC, bancos, cheques, compras,
pólizas de importación, partida doble y estados financieros.

## Arranque rápido

```bash
# Backend
cd backend
cp .env.example .env      # llenar DATABASE_URL (Supabase)
npm install
npm run migrate           # aplica migrations/*.sql
npm run dev               # http://localhost:3001/api/salud

# Frontend
cd app
cp .env.example .env
npm install
npm run dev               # http://localhost:5173
```

## Estructura

| Carpeta | Qué es |
|---|---|
| `app/` | React 18 + Vite + TypeScript + Tailwind |
| `backend/` | Express + TypeScript, API y runner de migraciones |
| `migrations/` | Esquema SQL versionado (001, 002, …) |
| `docker/` | docker-compose para VPS/local futuro |

Convenciones y reglas del proyecto: ver `CLAUDE.md`.