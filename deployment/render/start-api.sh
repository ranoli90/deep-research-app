#!/bin/sh
set -eu

# Render assigns PORT for an HTTP service; the application intentionally keeps
# its own explicit API_PORT configuration.  Prefer an explicit API_PORT for
# non-Render operators, otherwise consume Render's assigned value.
export API_HOST="${API_HOST:-0.0.0.0}"
export API_PORT="${API_PORT:-${PORT:-10000}}"

# loadConfig performs strict validation of DATABASE_URL, production auth,
# fixture disablement, and every spending/route flag before Fastify listens.
# Use the installed workspace binary directly: a running image must not need
# Corepack to download a package manager.
exec node_modules/.bin/tsx apps/backend/src/api/server.ts
