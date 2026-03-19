#!/bin/bash
# Notion Agent CLI: setup validation (runs on session start)

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

errors=0

# Check node_modules
if [ ! -d "$ROOT/node_modules" ]; then
  echo "notion-agent-cli: dependencies not installed. Run: cd $ROOT && npm install" >&2
  errors=1
fi

# Check NOTION_TOKEN
if [ -z "$NOTION_TOKEN" ]; then
  # Try loading from plugin .env
  if [ -f "$ROOT/.env" ]; then
    TOKEN=$(grep '^NOTION_TOKEN=' "$ROOT/.env" | cut -d= -f2-)
    if [ -n "$TOKEN" ]; then
      exit 0
    fi
  fi
  echo "notion-agent-cli: NOTION_TOKEN not set. Run: cd $ROOT && npm run setup" >&2
  errors=1
fi

exit $errors
