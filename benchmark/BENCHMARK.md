# Benchmark Reproduction Guide

This benchmark compares Notion Agent CLI (NAC) with the official Notion MCP interface under controlled prompts and shared Notion fixtures.

It measures:

- turn count (how many agentic turns each interface needs)
- session cost (USD per task)
- tool-channel contamination (NAC sessions should not use MCP tools, and vice versa)
- NAC workflow adherence (did the model pick the intended compound action?)
- correctness (did the created artifact match the specification?)

## What The Benchmark Is Actually Measuring

The benchmark is designed to answer a specific question:

> Once the model knows how to use the interface, is the task-level CLI cheaper than the endpoint-level MCP path?

To make that comparison fair, the NAC condition injects the body of `SKILL.md` into the prompt. That equalizes tool knowledge with MCP, whose tool schemas are already loaded by the framework.

This means the benchmark measures interface efficiency, not natural skill discovery.

## Scenarios

Ten scenarios cover five capability classes: read + synthesize, structured data, compound mutations, batch operations, and table/database creation.

### Read + Synthesize

| S | Task | Expected NAC path | Fixture data |
|---|---|---|---|
| S1 | Read page, create summary with >= 3 bullets | `getPage` -> `createPage` | `BENCH_PAGE` |
| S2 | Query database, create bullet report | `queryDatabase` -> `createPage` | `BENCH_DB` |

### Compound Mutations

| S | Task | Expected NAC path | Fixture data |
|---|---|---|---|
| S3 | Copy page, add "Modifications" heading | `copyPageWith` | `BENCH_PAGE` |
| S5 | Replace section content with specified text | `replaceSection` | `BENCH_PAGE`, `BENCH_SECTION` |
| S8 | Copy page, append "Benchmark Notes" section | `copyPageWith` | `BENCH_PAGE` |

### Property Updates

| S | Task | Expected NAC path | Fixture data |
|---|---|---|---|
| S4 | Set one property on one entry | `setProperties` | `BENCH_ENTRY` |
| S7 | Set one property on three entries | `batchSetProperties` | `BENCH_ENTRIES` |

### Multi-Source Composition

| S | Task | Expected NAC path | Fixture data |
|---|---|---|---|
| S6 | Merge 3 pages into one with sections | `createPage` -> `mergePages` | `BENCH_MERGE_SOURCES` |

### Table and Database Creation

| S | Task | Expected NAC path | Fixture data |
|---|---|---|---|
| S9 | Create page with 30-row simple table from fixture | `createPage` (with markdown table) | `bench-table.md` (inline in prompt) |
| S10 | Create database with inferred schema from fixture | `importTable` | `bench-table.md` (inline in prompt) |

S9 and S10 use the same 30-row, 5-column fixture (`benchmark/fixtures/bench-table.md`): international films with columns Film (title), Director (rich_text), Year (number), Genre (select), and Rating (number). The fixture is embedded in the prompt so both NAC and MCP sessions have equal access to the data.

For S10, the model must infer column types from the data. The expected types are: Film as title, Director as rich_text, Year as number, Genre as select (repeated values), Rating as number. The validator checks structural correctness, not exact type inference.

## Validation

`validate-session.mjs` checks correctness for each scenario after the session completes. It uses the CLI to read back the created artifacts from Notion.

| S | Checks |
|---|---|
| S1 | Page exists, >= 3 bullet points |
| S2 | Page exists, >= 1 bullet entry |
| S3 | Page exists, "Modifications" heading present |
| S4 | Benchmark Marker property set on entry |
| S5 | Section updated with expected text, no duplicated content |
| S6 | Page exists, >= 3 headings (one per source) |
| S7 | Benchmark Marker set on all 3 entries |
| S8 | Page exists, "Benchmark Notes" heading present |
| S9 | Page exists, pipe table present, >= 25 data rows, 5 columns, expected headers, spot-check first/last film |
| S10 | Database found via search, >= 25 entries, no excess "Untitled" rows, spot-check 3 film names, Year/Rating/Genre values preserved |

S1-S8 validation is lightweight (existence + structural shape). S9-S10 validation is richer: it checks row/column counts, header names, data integrity through spot-checks, and (for S10) verifies that typed property values survived the database creation pipeline.

The runner does **not** yet invoke the validator automatically. Run it manually:

```bash
node benchmark/validate-session.mjs "<marker>" <scenario>
```

## Isolation

Each session runs in an isolated Claude home directory to prevent cross-contamination:

- `~/.claude-bench-actions` for NAC sessions (no MCP plugin installed)
- `~/.claude-bench-mcp` for MCP sessions (Notion MCP plugin installed, no NAC skill)

Contamination is detected post-hoc: NAC sessions must not contain `mcp__` tool calls, MCP sessions must not contain `Bash` tool calls. Contaminated sessions are flagged in the results.

All sessions run sequentially. There is no parallel mode because the Notion fixtures are shared. Fixture reset runs before each session.

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
| Database | `BENCH_DB` | Database with `Benchmark Marker` text property |
| Single entry | `BENCH_ENTRY` | Entry in `BENCH_DB` for S4 |
| Three entries | `BENCH_ENTRIES` | Three entries in `BENCH_DB` for S7 |
| Three source pages | `BENCH_MERGE_SOURCES` | Source pages for S6 merge |
| Section heading | `BENCH_SECTION` | Heading name in `BENCH_PAGE` for S5 |

S9 and S10 do not require additional fixtures. The table data is in `benchmark/fixtures/bench-table.md` and is embedded in the prompt.

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
uv run --project benchmark benchmark/run.py all -s 1-10 -n 5 -m claude-sonnet-4-6
```

Run only NAC:

```bash
uv run --project benchmark benchmark/run.py actions -s 1-10 -n 5 -m claude-sonnet-4-6
```

Run only MCP:

```bash
uv run --project benchmark benchmark/run.py mcp -s 1-10 -n 5 -m claude-sonnet-4-6
```

Run only the new table/database scenarios:

```bash
uv run --project benchmark benchmark/run.py all -s 9,10 -n 3 -m claude-sonnet-4-6
```

Parse stored runs:

```bash
uv run --project benchmark benchmark/run.py parse
uv run --project benchmark benchmark/run.py parse -r <run-id>
uv run --project benchmark benchmark/run.py parse --nac <run-id> --mcp <run-id>
```

Package shortcut:

```bash
npm run bench -- -s 1-10 -n 5 -m claude-sonnet-4-6
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

## Notes On Interpretation

- NAC results in this benchmark are prompt-injected, not natural-discovery runs. The model receives `SKILL.md` in the prompt.
- Behavior analysis is strongest for NAC because the intended workflow is explicit.
- S9 and S10 are asymmetric by design: NAC has `createPage` (markdown table support) and `importTable` (single compound action), while MCP must orchestrate multiple low-level API calls. The benchmark measures whether that asymmetry translates to fewer turns and lower cost.
- S10 validation checks structural correctness (entry count, data integrity), not exact schema type inference. A model that creates all columns as `rich_text` will still pass if the data is preserved.
- If you care about trigger behavior, inspect the natural-discovery runs separately.
