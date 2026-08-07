#!/bin/sh
# Ensure bind-mounted data/music dirs exist and are writable by the app user.
# Plain Docker often creates host bind dirs as root — chown when we start as root.
set -eu

DATA_DIR="${POLARR_DATA_DIR:-/data}"
MUSIC_DIR="${POLARR_MUSIC_DIR:-/music}"
DOWNLOADS_DIR="${POLARR_DOWNLOADS_DIR:-${MUSIC_DIR}/downloads}"

mkdir -p "$DATA_DIR" "$MUSIC_DIR" "$DOWNLOADS_DIR" \
  "$DATA_DIR/avatars" "$DATA_DIR/bin" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR" "$MUSIC_DIR" 2>/dev/null || true
  # Drop privileges for the app process
  if command -v gosu >/dev/null 2>&1; then
    exec gosu node "$@"
  fi
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=node --regid=node --init-groups -- "$@"
  fi
  echo "polarr: warning: running as root (gosu/setpriv missing)" >&2
fi

# Non-root (e.g. Umbrel user: 1000:1000) — verify we can write the data dir
if ! touch "$DATA_DIR/.polarr-write-test" 2>/dev/null; then
  echo "polarr: cannot write to $DATA_DIR (SQLITE_CANTOPEN). Fix ownership, e.g.:" >&2
  echo "  sudo chown -R 1000:1000 $DATA_DIR" >&2
  exit 1
fi
rm -f "$DATA_DIR/.polarr-write-test"

exec "$@"
