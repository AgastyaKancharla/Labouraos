#!/bin/sh
# One-off clean-up of test data before going live (src/scripts/clear-test-data.ts).
# Run from the Render shell of the web service:
#   npm run clear:test-data -- --keep-names "Reddy,Stylish"          (check only)
#   npm run clear:test-data -- --keep BZ-…,BZ-… --delete              (deletes; cannot be undone)
set -e
cd "$(dirname "$0")/.."
if [ ! -f dist/scripts/clear-test-data.js ]; then
  echo "dist/scripts/clear-test-data.js is missing: run this on the deployed web service (or after npm run build:api)." >&2
  exit 1
fi
exec node dist/scripts/clear-test-data.js "$@"
