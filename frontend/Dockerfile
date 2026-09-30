# syntax=docker/dockerfile:1
# =========================================================================
# Imagen de producción del frontend Angular (build estático servido por nginx).
#
# Construcción:  docker build --build-arg API_URL=https://api-gateway.sistemaslab.dev/api/ruleta -t ruleta-frontend .
#
# `API_URL` se sustituye en environment.prod.ts ANTES del build: Angular
# empaqueta el valor en el bundle en tiempo de compilación (es un SPA
# estático, no hay proceso corriendo que pueda leer variables de entorno en
# runtime). Sin este build-arg, el valor por defecto es una ruta relativa
# ('/api/v1'), pensada para cuando el frontend y la API comparten dominio.
# =========================================================================

ARG NODE_VERSION=22

# --- Etapa de build -------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

ARG API_URL=/api/v1
RUN sed -i "s#apiUrl: '.*'#apiUrl: '${API_URL}'#" src/environments/environment.prod.ts

RUN npx ng build --configuration production

# --- Etapa de servidor ------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1
