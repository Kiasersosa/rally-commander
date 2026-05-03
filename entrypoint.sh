#!/bin/sh
set -e

echo "[entrypoint] running drizzle migrations…"
npx --no-install drizzle-kit migrate

echo "[entrypoint] running bootstrap…"
npx --no-install tsx src/lib/db/bootstrap.ts || echo "[entrypoint] bootstrap script returned non-zero (continuing)"

echo "[entrypoint] starting Next.js server on :3000…"
exec node server.js
