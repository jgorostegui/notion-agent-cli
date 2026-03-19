#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Sonnet: nac + mcp, 5 iterations, all scenarios
uv run --project . run.py all -s 1-8 -n 5 -m claude-sonnet-4-6

# Opus: nac + mcp, 5 iterations, all scenarios
uv run --project . run.py all -s 1-8 -n 5 -m claude-opus-4-6
