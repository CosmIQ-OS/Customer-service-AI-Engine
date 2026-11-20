# syntax=docker/dockerfile:1
# Multi-stage build: dashboard assets + backend, then a slim runtime image.
FROM node:22-bookworm-slim AS dashboard
WORKDIR /dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# ca-certificates ensures TLS verification for Neon PostgreSQL and external APIs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# tsx runs the TypeScript sources directly, so dev dependencies stay installed.
RUN npm ci --include=dev --no-audit --no-fund && npm cache clean --force
COPY src/ ./src/
COPY tsconfig.json ./
COPY --from=dashboard /dashboard/dist/ ./dashboard/dist/
# Run as the built-in node user (uid/gid 1000); ensure fallback data directory is writable.
RUN mkdir -p /app/data \
  && chown -R node:node /app \
  && chmod -R 777 /app/data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
