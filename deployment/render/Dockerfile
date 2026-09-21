# syntax=docker/dockerfile:1
# Render API and worker images intentionally run the repository's real TypeScript
# entrypoints.  There is no fixture or development entrypoint in this image.
FROM node:20-bookworm-slim AS dependencies

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/research-core/package.json packages/research-core/package.json
COPY packages/design/package.json packages/design/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
# The backend deliberately emits no JavaScript: runtime uses the checked-in
# TypeScript entrypoints through tsx, which remains in this production image.
RUN pnpm --filter @deep/backend build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    STORAGE_DIR=/app/data/storage
RUN mkdir -p /app/data/storage \
    && chown -R node:node /app
COPY --from=build --chown=node:node /app /app
USER node

# Render passes PORT to web services.  start-api.sh maps it to the existing
# API_PORT configuration before the real Fastify server starts.
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.API_PORT || process.env.PORT || '10000') + '/ready').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["sh", "deployment/render/start-api.sh"]
