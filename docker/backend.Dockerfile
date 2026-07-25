# Backend Express compilado. Contexto de build: la RAÍZ del repo
#   docker compose -f docker/docker-compose.yml build backend
FROM node:22-alpine AS compilar
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=compilar /app/backend/dist ./dist
# migrate.ts busca ../../migrations relativo a dist/ → /app/migrations
COPY migrations /app/migrations
EXPOSE 3001
# Aplica migraciones pendientes y arranca (misma base = idempotente)
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]
