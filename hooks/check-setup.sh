#!/bin/bash
# Notion Agent CLI: setup validation (runs on session start)

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

errors=0

# Auto-install runtime dependencies if missing
if [ ! -d "$ROOT/node_modules/@notionhq/client" ]; then
  echo "notion-agent-cli: installing dependencies..." >&2
  if [ -f "$ROOT/package-lock.json" ]; then
    if ! (cd "$ROOT" && npm ci --omit=dev --no-fund --no-audit --loglevel=error) >&2; then
      echo "notion-agent-cli: dependency install failed. Run manually: node $ROOT/scripts/setup.mjs" >&2
      errors=1
    fi
  elif ! (cd "$ROOT" && npm install --omit=dev --no-fund --no-audit --loglevel=error) >&2; then
    echo "notion-agent-cli: dependency install failed. Run manually: node $ROOT/scripts/setup.mjs" >&2
    errors=1
  fi
fi

# Check NOTION_TOKEN (env var > plugin .env)
if [ -z "$NOTION_TOKEN" ]; then
  if [ -f "$ROOT/.env" ]; then
    TOKEN=$(grep '^NOTION_TOKEN=' "$ROOT/.env" | cut -d= -f2-)
    if [ -n "$TOKEN" ]; then
      exit 0
    else
      echo "notion-agent-cli: .env exists but NOTION_TOKEN is empty. Run: node $ROOT/scripts/setup.mjs" >&2
      errors=1
    fi
  else
    echo "notion-agent-cli: not authenticated. Run: node $ROOT/scripts/setup.mjs" >&2
    errors=1
  fi
fi

exit $errors
