#!/bin/sh
# Apply the already-migrated Vision preset into $DSH_HOME.
# This agent cannot write ~/.dsh (sandbox EPERM); run this in a normal terminal.
set -e
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SRC="$ROOT/backups"
HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
DEST="$HOME_DIR/.agent-presets/vision-bench"
if [ ! -f "$SRC/vision-bench-migrated-agent.cordis.yml" ]; then
  echo "missing migrated files under $SRC" >&2
  exit 1
fi
mkdir -p "$DEST"
cp "$SRC/vision-bench-migrated-agent.cordis.yml" "$DEST/agent.cordis.yml"
cp "$SRC/vision-bench-migrated-preset.yml" "$DEST/preset.yml"
cp "$SRC/vision-bench-migrated-marker.json" "$DEST/.dsh-vision-bench"
echo "wrote $DEST (schema 3, prefix, dsh-vision-bench/agent)"
echo "new Session required; existing sessions keep the old generation"
