#!/bin/sh
# Security L3: one-off pay page token backfill (DEPLOY.md, "Pay page tokens: one-off backfill").
# Run from the Render shell of the web service after the release is live:
#   npm run backfill:pay-page-tokens -- --resend
# Needs the built app (dist/), which the web service has.
set -e
cd "$(dirname "$0")/.."
if [ ! -f dist/scripts/backfill-pay-page-tokens.js ]; then
  echo "dist/scripts/backfill-pay-page-tokens.js is missing: run this on the deployed web service (or after npm run build:api)." >&2
  exit 1
fi
exec node dist/scripts/backfill-pay-page-tokens.js "$@"
