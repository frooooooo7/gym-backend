FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist

# Writable by non-root user (multer saves exercise images here).
RUN mkdir -p /app/uploads/exercise-images && chown -R node:node /app/uploads

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
