#!/usr/bin/env bash
set -euo pipefail

# Verify benchmark environments are correctly configured before running.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_HOME="$HOME/.claude-bench-mcp"
ACTIONS_HOME="$HOME/.claude-bench-actions"
ERRORS=0

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; ERRORS=$((ERRORS + 1)); }

echo "=== Benchmark Setup Check ==="
echo ""

# ── 1. Bench HOME directories ────────────────────────────────────────────────
echo "Environments:"
[[ -d "$MCP_HOME/.claude" ]]     && pass "MCP HOME exists ($MCP_HOME)"     || fail "MCP HOME missing — run: bash benchmark/envs/setup-envs.sh"
[[ -d "$ACTIONS_HOME/.claude" ]] && pass "Actions HOME exists ($ACTIONS_HOME)" || fail "Actions HOME missing — run: bash benchmark/envs/setup-envs.sh"
[[ -d "$SCRIPT_DIR/envs/workdir" ]] && pass "workdir/ exists" || fail "workdir/ missing"

# ── 2. Auth (credentials in both HOMEs) ──────────────────────────────────────
echo ""
echo "Authentication:"
[[ -f "$MCP_HOME/.claude/.credentials.json" ]]     && pass "MCP HOME authenticated"     || fail "MCP HOME not authenticated — run: HOME=$MCP_HOME claude"
[[ -f "$ACTIONS_HOME/.claude/.credentials.json" ]] && pass "Actions HOME authenticated" || fail "Actions HOME not authenticated — run: HOME=$ACTIONS_HOME claude"

# ── 3. Plugins ────────────────────────────────────────────────────────────────
echo ""
echo "Plugins:"
if HOME="$MCP_HOME" claude plugin list 2>/dev/null | grep -q "Notion"; then
    pass "MCP HOME has Notion plugin"
else
    fail "MCP HOME missing Notion plugin — run: HOME=$MCP_HOME claude, then: /plugin install Notion"
fi

# Actions HOME should NOT have MCP — it uses --plugin-dir to load notion-agent-cli
if HOME="$ACTIONS_HOME" claude plugin list 2>/dev/null | grep -q "Notion"; then
    fail "Actions HOME has Notion MCP (contamination risk) — remove it"
else
    pass "Actions HOME has no MCP plugins (correct)"
fi

# Check notion-agent-cli plugin is loadable via --plugin-dir
if [[ -f "$PROJECT_DIR/.claude-plugin/plugin.json" ]]; then
    pass "notion-agent-cli plugin.json exists"
else
    fail "notion-agent-cli plugin.json missing at $PROJECT_DIR/.claude-plugin/plugin.json"
fi

# ── 4. Fixture IDs in .env ────────────────────────────────────────────────────
echo ""
echo "Fixture IDs (.env):"
ENV_FILE="$PROJECT_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
    fail ".env file missing — run: npm run setup"
else
    for VAR in NOTION_TOKEN BENCH_PAGE BENCH_PARENT BENCH_DB BENCH_ENTRY BENCH_SECTION BENCH_MERGE_SOURCES BENCH_ENTRIES; do
        if grep -qE "^(export )?${VAR}=.+" "$ENV_FILE"; then
            pass "$VAR is set"
        else
            fail "$VAR missing or empty in .env"
        fi
    done
fi

# ── 5. Dependencies ──────────────────────────────────────────────────────────
echo ""
echo "Dependencies:"
[[ -d "$PROJECT_DIR/node_modules/@notionhq" ]] && pass "node_modules installed" || fail "node_modules missing — run: npm install"
[[ -f "$SCRIPT_DIR/.venv/bin/python" ]]        && pass "benchmark venv exists"  || fail "benchmark venv missing — run: uv sync --project benchmark"
command -v claude &>/dev/null                  && pass "claude CLI in PATH"     || fail "claude CLI not found"

# Check claude version
CLAUDE_VER=$(claude --version 2>/dev/null | head -1 || echo "unknown")
echo "  ℹ claude: $CLAUDE_VER"

# ── 6. Wrapper scripts ───────────────────────────────────────────────────────
echo ""
echo "Wrapper scripts:"
[[ -x "$SCRIPT_DIR/envs/claude-mcp" ]]     && pass "claude-mcp is executable"     || fail "claude-mcp not executable"
[[ -x "$SCRIPT_DIR/envs/claude-actions" ]] && pass "claude-actions is executable" || fail "claude-actions not executable"

# ── Result ────────────────────────────────────────────────────────────────────
echo ""
if [[ $ERRORS -eq 0 ]]; then
    echo "All checks passed. Ready to run: bash benchmark/run-full.sh"
else
    echo "$ERRORS check(s) failed. Fix the issues above before running benchmarks."
    exit 1
fi
