#!/usr/bin/env bash
set -euo pipefail

# One-time setup for benchmark environments.
# Creates separate HOMEs so MCP and CLI modes don't share session history.
#
# After running this script:
#   HOME=~/.claude-bench-mcp claude          # auth + install Notion plugin
#   HOME=~/.claude-bench-actions claude      # auth only

MCP_HOME="$HOME/.claude-bench-mcp"
ACTIONS_HOME="$HOME/.claude-bench-actions"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$MCP_HOME/.claude" "$ACTIONS_HOME/.claude" "$SCRIPT_DIR/workdir"

echo "Created:"
echo "  $MCP_HOME"
echo "  $ACTIONS_HOME"
echo "  $SCRIPT_DIR/workdir"
echo ""
echo "Now run manually:"
echo "  HOME=$MCP_HOME claude        # complete onboarding, then: /plugin install Notion"
echo "  HOME=$ACTIONS_HOME claude    # complete onboarding only"
