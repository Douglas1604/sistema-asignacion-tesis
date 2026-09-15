# syntax=docker/dockerfile:1
# =========================================================================
# Imagen de producción de la API tesis-ruleta (Node LTS sobre Alpine).
#
# Construcción:  docker build -t tesis-ruleta-backend ./backend
# Despliegue:    ver ../docker-compose.yml y docs/OCELOT-DEPLOY.md
#
# Decisiones de seguridad:
#  - Multi-stage: la imagen final solo contiene dependencias de producción
#    (sin supertest, nodemon ni la caché de npm).
#  - `npm ci --ignore-scripts`: instalación reproducible desde el lockfile y
#    sin ejecutar scripts de instalación de terceros (ninguna dependencia de
#    la API los necesita: bcryptjs y mysql2 son JavaScript puro).
#  - El código pertenece a root y el proceso corre como `node` (UID 1000):
#    el proceso no puede modificar su propio código aunque fuera comprometido.
#  - Nunca se copia `.env`: la configuración llega por variables de entorno.
# =========================================================================

# Versión mayor de Node LTS. La suite de pruebas se valida sobre Node 22.
ARG NODE_VERSION=22

# -------------------------------------------------------------------------
# Etapa 1: dependencias de producción
# -------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps

WORKDIR /app

# Solo los manifiestos: la capa de dependencias se reutiliza mientras no
# cambie el lockfile, aunque cambie el código.
COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# -------------------------------------------------------------------------
# Etapa 2: imagen de ejecución
# -------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime

# DOTENV_CONFIG_QUIET: no hay .env en el contenedor; se silencia el aviso de dotenv.
ENV NODE_ENV=production \
    PORT=3000 \
    DOTENV_CONFIG_QUIET=true

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json server.js ./
COPY src ./src
# Utilidad operativa (npm run migrate:passwords) disponible con `docker exec`.
COPY scripts ./scripts

# Usuario sin privilegios incluido en la imagen oficial de Node.
USER node

EXPOSE 3000

# Usa `fetch` nativo de Node: no requiere curl/wget y trata el 503 que
# devuelve /health sin base de datos como contenedor no saludable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# Forma exec: `node` recibe SIGTERM directamente y server.js ejecuta el
# apagado ordenado (drena peticiones y cierra el pool de MariaDB).
CMD ["node", "server.js"]
