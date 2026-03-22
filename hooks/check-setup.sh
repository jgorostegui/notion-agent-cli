#!/bin/bash
# Check NOTION_TOKEN is available

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

if [ -z "$NOTION_TOKEN" ]; then
  # Fallback: check .env (dev mode / legacy)
  if [ -f "$ROOT/.env" ]; then
    TOKEN=$(grep '^NOTION_TOKEN=' "$ROOT/.env" | cut -d= -f2-)
    if [ -n "$TOKEN" ]; then
      exit 0
    fi
  fi
  echo "notion-agent-cli: NOTION_TOKEN not set. Run /notion-agent-cli:setup or add NOTION_TOKEN to ~/.claude/settings.json env block." >&2
  exit 1
fi
