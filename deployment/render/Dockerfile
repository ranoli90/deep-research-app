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

COPY tsconfig.base.json ./
COPY apps/backend/ apps/backend/
COPY packages/contracts/ packages/contracts/
COPY packages/research-core/ packages/research-core/
COPY packages/design/ packages/design/
COPY deployment/render/ deployment/render/
# The backend deliberately emits no JavaScript: runtime uses the checked-in
# TypeScript entrypoints through tsx, which remains in this production image.
RUN pnpm --filter @deep/backend build

FROM python:3.12-slim-bookworm AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOME=/app \
    STORAGE_DIR=/app/data/storage \
    EXTRACTION_RUNTIME=/opt/extraction-runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap ca-certificates libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
COPY apps/backend/extraction/requirements.lock /tmp/extraction-requirements.lock
# The production worker uses the existing offline parser through bubblewrap.
# Keep its wheels hash-pinned; if the host denies user namespaces, extraction
# fails closed instead of silently running the parser without isolation.
RUN python3 -m venv /opt/extraction-runtime \
    && /opt/extraction-runtime/bin/python -m pip install --no-cache-dir --require-hashes --only-binary=:all: -r /tmp/extraction-requirements.lock \
    && rm /tmp/extraction-requirements.lock
COPY --from=build --chown=10001:10001 /app /app
RUN mkdir -p /app/data/storage \
    && chown -R 10001:10001 /app
USER 10001:10001

# The same image also runs a worker with no HTTP listener, so an image-wide
# HEALTHCHECK would incorrectly fail that process. Configure /ready only on
# the Render web service after the backend readiness contract is accepted.
EXPOSE 10000
CMD ["sh", "deployment/render/start-api.sh"]
