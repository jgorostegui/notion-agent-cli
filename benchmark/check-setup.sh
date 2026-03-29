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
if HOME="$MCP_HOME" claude plugin list 2>/dev/null | grep -qi "notion"; then
    pass "MCP HOME has Notion plugin"
else
    fail "MCP HOME missing Notion plugin — run: HOME=$MCP_HOME claude, then: /plugin install Notion"
fi

# Actions HOME should NOT have the official Notion MCP plugin (contamination risk)
if HOME="$ACTIONS_HOME" claude plugin list 2>/dev/null | grep -qi "notion@claude-plugins-official"; then
    fail "Actions HOME has Notion MCP plugin enabled (contamination risk) — disable it"
else
    pass "Actions HOME has no Notion MCP plugin (correct)"
fi

# Actions HOME should have notion-agent-cli installed
if HOME="$ACTIONS_HOME" claude plugin list 2>/dev/null | grep -q "notion-agent-cli"; then
    NAC_VER=$(HOME="$ACTIONS_HOME" claude plugin list 2>/dev/null | grep -oP 'Version: \K[0-9.]+' || echo "?")
    pass "notion-agent-cli installed and enabled (v$NAC_VER)"
else
    fail "notion-agent-cli not installed in Actions HOME — run: HOME=$ACTIONS_HOME claude plugin marketplace add jgorostegui/notion-agent-cli && claude plugin install notion-agent-cli@notion-agent-cli-marketplace"
fi

# Verify CLI loads
if node "$PROJECT_DIR/scripts/actions.mjs" --help 2>/dev/null | grep -q "createPage"; then
    pass "notion-agent-cli CLI loads (--help works)"
else
    fail "notion-agent-cli CLI broken — node scripts/actions.mjs --help failed"
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

# ── 7. Notion API connectivity ──────────────────────────────────────────────
echo ""
echo "Notion API:"
# Source NOTION_TOKEN from .env if not in environment
if [[ -z "${NOTION_TOKEN:-}" ]] && [[ -f "$ENV_FILE" ]]; then
    NOTION_TOKEN=$(grep -E "^(export )?NOTION_TOKEN=" "$ENV_FILE" | head -1 | sed 's/^.*=//' | tr -d '"'"'")
    export NOTION_TOKEN
fi

if [[ -n "${NOTION_TOKEN:-}" ]]; then
    # Check token works by fetching BENCH_PAGE
    BENCH_PAGE_ID=$(grep -E "^(export )?BENCH_PAGE=" "$ENV_FILE" | head -1 | sed 's/^.*=//' | tr -d '"'"'")
    if [[ -n "$BENCH_PAGE_ID" ]]; then
        if node "$PROJECT_DIR/scripts/actions.mjs" getPage "$BENCH_PAGE_ID" >/dev/null 2>&1; then
            pass "NOTION_TOKEN can access BENCH_PAGE"
        else
            fail "NOTION_TOKEN cannot access BENCH_PAGE — check token and page sharing"
        fi
    fi

    BENCH_PARENT_ID=$(grep -E "^(export )?BENCH_PARENT=" "$ENV_FILE" | head -1 | sed 's/^.*=//' | tr -d '"'"'")
    if [[ -n "$BENCH_PARENT_ID" ]]; then
        if node "$PROJECT_DIR/scripts/actions.mjs" getTree "$BENCH_PARENT_ID" --depth 0 >/dev/null 2>&1; then
            pass "NOTION_TOKEN can access BENCH_PARENT"
        else
            fail "NOTION_TOKEN cannot access BENCH_PARENT — check token and page sharing"
        fi
    fi
else
    fail "NOTION_TOKEN not set in environment or .env"
fi

# ── Result ────────────────────────────────────────────────────────────────────
echo ""
if [[ $ERRORS -eq 0 ]]; then
    echo "All checks passed. Ready to run: uv run --project benchmark benchmark/run.py all -s 1-10 -n 1 -m claude-sonnet-4-6"
else
    echo "$ERRORS check(s) failed. Fix the issues above before running benchmarks."
    exit 1
fi
