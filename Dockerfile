# syntax=docker/dockerfile:1

# ---- build: compile TypeScript -------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime: production deps + compiled JS only -------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Upload directories must exist in the image and belong to `node`: a fresh
# named volume mounted at /app/uploads copies this content and ownership on
# first mount, so the non-root process can write exercise images and avatars.
RUN mkdir -p /app/uploads/exercise-images /app/uploads/avatars \
  && chown -R node:node /app/uploads

USER node

EXPOSE 3000

# Liveness only (no DB call); use GET /ready for readiness.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/health" || exit 1

CMD ["node", "dist/index.js"]
