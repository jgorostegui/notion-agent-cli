#!/bin/bash
# Notion Agent CLI: setup validation (runs on session start)

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

errors=0

# Auto-install dependencies if missing
if [ ! -d "$ROOT/node_modules" ]; then
  echo "notion-agent-cli: installing dependencies..." >&2
  (cd "$ROOT" && npm install --no-fund --no-audit --loglevel=error 2>&1) >&2
  if [ ! -d "$ROOT/node_modules" ]; then
    echo "notion-agent-cli: npm install failed. Run manually: cd $ROOT && npm install" >&2
    errors=1
  fi
fi

# Check NOTION_TOKEN (env var > plugin .env)
if [ -z "$NOTION_TOKEN" ]; then
  if [ -f "$ROOT/.env" ]; then
    TOKEN=$(grep '^NOTION_TOKEN=' "$ROOT/.env" | cut -d= -f2-)
    if [ -n "$TOKEN" ]; then
      exit 0
    fi
  fi
  echo "notion-agent-cli: NOTION_TOKEN not set. Ask the user for their Notion integration token (starts with ntn_), then run: echo \"<token>\" | node $ROOT/scripts/setup.mjs --with-token" >&2
  errors=1
fi

exit $errors
