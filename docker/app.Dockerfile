# Frontend Vite servido por nginx (proxy /api → backend). Contexto: raíz del repo
FROM node:22-alpine AS compilar
WORKDIR /app
COPY app/package*.json ./
RUN npm ci
COPY app ./
# Las llaves VITE_* se hornean en el build (son públicas por diseño)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

FROM nginx:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=compilar /app/dist /usr/share/nginx/html
EXPOSE 80
