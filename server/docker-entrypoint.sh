#!/bin/sh
# Platform container entry point.
#   serve (default)  seed the demo data on the very first start, then run the API
#   seed             wipe the database and seed fresh demo data (stop the platform first)
#   anything else    run it as a command, e.g. `sh`
set -e
cd /app/server

node_ts() {
  node --disable-warning=ExperimentalWarning --import tsx "$@"
}

case "${1:-serve}" in
  serve)
    if [ ! -f "$CCL_DB" ] && [ "${CCL_SEED_ON_FIRST_START:-1}" = 1 ]; then
      echo "[entrypoint] no database at $CCL_DB yet, seeding the demo data"
      node_ts src/seed.ts
    fi
    exec node --disable-warning=ExperimentalWarning --import tsx src/index.ts
    ;;
  seed)
    exec node --disable-warning=ExperimentalWarning --import tsx src/seed.ts
    ;;
  *)
    exec "$@"
    ;;
esac
