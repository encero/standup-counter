#!/bin/sh
# Run the server as the unprivileged `node` user.
#
# When the container starts as root (plain `docker run`, or an existing volume
# created by an older root-running image), first hand the data directory to
# `node` so SQLite can write the database and its journal, then drop
# privileges. When it already starts as non-root (k8s runAsUser + fsGroup),
# just exec.
set -e

if [ "$(id -u)" = "0" ]; then
  DATA_DIR="$(dirname "${DB_PATH:-/data/standup.db}")"
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec su-exec node "$@"
fi

exec "$@"
