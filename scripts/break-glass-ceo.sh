#!/bin/sh
# Break-glass for a locked-out single CEO (DEPLOY.md, "Break-glass: a locked-out CEO").
# Run from the Render shell of the web service:
#   BREAK_GLASS_CONFIRM='<the BREAK_GLASS_SECRET value>' npm run break-glass:ceo -- CEO-00001
# Not reachable over HTTP. Needs the built app (dist/), which the web service has.
set -e
cd "$(dirname "$0")/.."
if [ ! -f dist/scripts/break-glass-ceo.js ]; then
  echo "dist/scripts/break-glass-ceo.js is missing: run this on the deployed web service (or after npm run build:api)." >&2
  exit 1
fi
exec node dist/scripts/break-glass-ceo.js "$@"
