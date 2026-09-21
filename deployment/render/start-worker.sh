#!/bin/sh
set -eu

# This is the real durable worker entrypoint.  It shares the image and requires
# the same production configuration, database, migrations, and queue as API.
# Do not use dev:demo or diagnostic-main in a hosted service.
exec node_modules/.bin/tsx apps/backend/src/worker/main.ts
