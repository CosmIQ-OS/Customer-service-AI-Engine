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
# Build tools are needed so better-sqlite3 can compile when no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# tsx runs the TypeScript sources directly, so dev dependencies stay installed.
RUN npm ci --include=dev --no-audit --no-fund && npm cache clean --force
COPY src/ ./src/
COPY tsconfig.json ./
COPY --from=dashboard /dashboard/dist/ ./dashboard/dist/
# Run as an unprivileged user; the data directory is owned by that user.
RUN groupadd --system --gid 1001 app \
  && useradd --system --uid 1001 --gid app --home-dir /app --shell /usr/sbin/nologin app \
  && mkdir -p /app/data \
  && chown -R app:app /app
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
