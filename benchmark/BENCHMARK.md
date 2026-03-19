# Benchmark Reproduction Guide

This benchmark compares Notion Agent CLI (NAC) with the official Notion MCP interface under controlled prompts and shared Notion fixtures.

It is useful for measuring:

- turn count
- session cost
- tool-channel contamination
- NAC workflow adherence

It is **not** yet a full automated correctness harness. The repository includes `validate-session.mjs`, but the default runner does not invoke it automatically.

## What The Benchmark Is Actually Measuring

The benchmark is designed to answer a specific question:

> once the model knows how to use the interface, is the task-level CLI cheaper than the endpoint-level MCP path?

To make that comparison fair, the NAC condition injects the body of `SKILL.md` into the prompt. That equalizes tool knowledge with MCP, whose tool schemas are already loaded by the framework.

This means the benchmark measures interface efficiency, not natural skill discovery.

## Prerequisites

- Claude Code installed and authenticated
- a Notion integration token in `.env`
- Python with `uv`
- benchmark environments bootstrapped once

## Notion Fixtures

Create the following Notion objects and share them with the integration:

| Fixture | Env var | Purpose |
|---|---|---|
| Source page | `BENCH_PAGE` | Content-rich page used for read/copy/replace scenarios |
| Parent page | `BENCH_PARENT` | Empty parent where benchmark-created pages are placed |
| Database | `BENCH_DB` | Database used for query and property-update scenarios |
| Single entry | `BENCH_ENTRY` | Entry used in scenario 4 |
| Three entries | `BENCH_ENTRIES` | Entry IDs for scenario 7 |
| Three source pages | `BENCH_MERGE_SOURCES` | Source pages for scenario 6 |
| Section heading | `BENCH_SECTION` | Heading name used in scenario 5 |

The database should include a text property called `Benchmark Marker`. That keeps the property-update scenarios from polluting more meaningful schema fields.

Store the values in `.env`:

```bash
NOTION_TOKEN="<token>"
BENCH_PAGE="<page-id>"
BENCH_PARENT="<parent-id>"
BENCH_DB="<database-id>"
BENCH_ENTRY="<entry-id>"
BENCH_ENTRIES="<id1>,<id2>,<id3>"
BENCH_MERGE_SOURCES="<id1>,<id2>,<id3>"
BENCH_SECTION="Goals"
```

## One-Time Environment Setup

Install benchmark dependencies:

```bash
uv sync --project benchmark
```

Create the two isolated Claude environments:

```bash
bash benchmark/envs/setup-envs.sh
```

Then authenticate both homes:

```bash
HOME=~/.claude-bench-mcp claude
HOME=~/.claude-bench-actions claude
```

In the MCP home, install the Notion MCP plugin. In the actions home, do not install the MCP plugin.

Quick check:

```bash
bash benchmark/check-setup.sh
```

## Running Benchmarks

Run both NAC and MCP:

```bash
uv run --project benchmark benchmark/run.py all -s 1-8 -n 5 -m claude-sonnet-4-6
```

Run only NAC:

```bash
uv run --project benchmark benchmark/run.py actions -s 1-8 -n 5 -m claude-sonnet-4-6
```

Run only MCP:

```bash
uv run --project benchmark benchmark/run.py mcp -s 1-8 -n 5 -m claude-sonnet-4-6
```

Parse stored runs:

```bash
uv run --project benchmark benchmark/run.py parse
uv run --project benchmark benchmark/run.py parse -r 20260316-191644
uv run --project benchmark benchmark/run.py parse --nac 20260316-191644 --mcp 20260316-191644
```

Package shortcut:

```bash
npm run bench -- -s 1-8 -n 5 -m claude-sonnet-4-6
```

## What The Runner Does

For every session, the runner:

1. resets the benchmark fixtures with `fixture-reset.mjs`
2. runs Claude in an isolated home through `benchmark/envs/claude-actions` or `benchmark/envs/claude-mcp`
3. stores the session JSON and JSONL under `benchmark/results/<run-id>/`

After the run, it:

- checks tool-channel contamination
- runs behavior analysis on NAC sessions
- prints a comparison table when using the `all` subcommand

All sessions run sequentially. There is no parallel mode because the fixtures are shared.

## What It Does Not Yet Do Automatically

The runner currently does **not** make the following guarantees:

- automatic correctness validation for every session
- required pass/fail gating based on generated page content
- perfect cleanup of benchmark-created pages after every run

The repository includes pieces for those jobs, but the default path is not yet fully wired.

## Output Layout

Results land in `benchmark/results/<run-id>/`:

```text
<run-id>/
├── env.json
├── nac-s1-1.json
├── nac-s1-1.jsonl
├── mcp-s1-1.json
├── mcp-s1-1.jsonl
├── ...
└── behavior.json
```

File meanings:

- `env.json`: model, fixture IDs, CLI version, plugin state
- `*.json`: Claude session summary with turns and cost
- `*.jsonl`: full transcript
- `behavior.json`: NAC behavior analysis, including workflow adherence

For charts and further analysis, open `benchmark/analysis.ipynb`.

## Scenarios

| S | Task | Expected NAC path | What it stresses |
|---|---|---|---|
| S1 | Read page, create summary | `getPage` -> `createPage` | Basic read + synthesize |
| S2 | Query database, create report | `queryDatabase` -> `createPage` | Structured read and report generation |
| S3 | Copy page with modifications | `copyPageWith` | Compound read + write |
| S4 | Update one property | `setProperties` | Simple mutation |
| S5 | Replace one section | `replaceSection` | Surgical in-place edit |
| S6 | Merge 3 pages into one | `createPage` -> `mergePages` | Multi-source composition |
| S7 | Batch update 3 entries | `batchSetProperties` | Batch mutation |
| S8 | Copy page and append notes | `copyPageWith` | Compound copy with modification |

## Notes On Interpretation

- NAC results in this benchmark are prompt-injected, not natural-discovery runs.
- Behavior analysis is strongest for NAC because the intended workflow is explicit.
- If you care about trigger behavior, inspect the natural-discovery runs separately.
- If you care about publication-grade correctness claims, tighten `validate-session.mjs` and wire it into `run.py` before rerunning.
