#!/bin/bash
# Install deps to CLAUDE_PLUGIN_DATA (persistent) and symlink into CLAUDE_PLUGIN_ROOT

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA="${CLAUDE_PLUGIN_DATA:-}"

# Skip in dev mode (no CLAUDE_PLUGIN_DATA)
[ -z "$DATA" ] && exit 0

# Install or update deps only when package.json changes
if ! diff -q "$ROOT/package.json" "$DATA/package.json" >/dev/null 2>&1; then
  echo "notion-agent-cli: installing dependencies..." >&2
  cp "$ROOT/package.json" "$DATA/package.json"
  cp "$ROOT/package-lock.json" "$DATA/package-lock.json" 2>/dev/null
  if ! (cd "$DATA" && npm install --omit=dev --no-fund --no-audit --loglevel=error) >&2; then
    echo "notion-agent-cli: dependency install failed" >&2
    rm -f "$DATA/package.json"
    exit 1
  fi
fi

# Always recreate symlink (CLAUDE_PLUGIN_ROOT changes on every update)
ln -sfn "$DATA/node_modules" "$ROOT/node_modules" 2>/dev/null
exit 0
