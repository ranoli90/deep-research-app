#!/bin/sh
set -eu

# Render's assigned PORT must win over a stale API_PORT in a service setting;
# it is the port routed to this container. Local operators may set API_PORT.
if [ -n "${PORT:-}" ]; then
  export API_HOST=0.0.0.0
  export API_PORT="$PORT"
else
  export API_HOST="${API_HOST:-0.0.0.0}"
  export API_PORT="${API_PORT:-10000}"
fi

# loadConfig performs strict validation of DATABASE_URL, production auth,
# fixture disablement, and every spending/route flag before Fastify listens.
# Use the installed workspace binary directly: a running image must not need
# Corepack to download a package manager.
exec node_modules/.bin/tsx apps/backend/src/api/server.ts
