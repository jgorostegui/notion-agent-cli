# Notion Agent CLI

Notion Agent CLI gives Claude Code a smaller, more usable interface for Notion.

Instead of making the model juggle raw block JSON, pagination, and multi-step API flows, it provides task-level actions with markdown in and markdown out. It is built for the work agents actually do: reading pages, querying databases, rewriting sections, copying and modifying content, merging pages, and updating batches of entries without turning every task into a chain of low-level calls.

## Where It Fits

Use the official Notion MCP server if you want raw endpoint access and do not mind letting the model orchestrate each API call itself.

Use `notion-agent-cli` if you want a smaller, task-oriented interface that:

- reads pages as markdown instead of raw block JSON
- lets the model write markdown instead of Notion block payloads
- hides pagination, chunking, rate limiting, and common multi-step workflows behind one command

| | Notion MCP | Notion Agent CLI |
|---|---|---|
| Main shape | Endpoint-level tools | Task-level CLI actions |
| Read output | Raw Notion JSON | Markdown by default |
| Write input | Block JSON assembled by the model | Markdown |
| Compound workflows | The model coordinates each step | The CLI does the coordination |
| Best use case | Full API coverage, low-level control | Common workspace work with fewer turns |

## What You Can Do

| Category | Examples |
|---|---|
| Read | `search`, `getPage`, `queryDatabase`, `getTree`, `exportPage` |
| Write | `createPage`, `updatePage`, `appendBlocks`, `setProperties`, `addComment` |
| Structural | `copyPageWith`, `mergePages`, `splitPage`, `replaceSection`, `flattenPage` |
| Batch | `batchSetProperties`, `batchArchive`, `batchTag` |
| Safety | `snapshot`, `restore`, `backupPage`, `transact` |
| Analysis | `workspaceMap`, `pageStats`, `diffPages`, `findDuplicates`, `findStale` |

## Installation

### 1. Get a Notion token

Create an integration at <https://www.notion.so/profile/integrations> and copy the token (starts with `ntn_`). Then share the pages and databases you want to access with the integration (page menu > Connections > add it).

### 2. Install the plugin

Pick one:

**From the terminal:**

```bash
claude plugin marketplace add jgorostegui/notion-agent-cli
claude plugin install notion-agent-cli@notion-agent-cli-marketplace
```

**From inside Claude Code:**

```
/plugin marketplace add jgorostegui/notion-agent-cli
/plugin install notion-agent-cli@notion-agent-cli-marketplace
/reload-plugins
```

**Manual (no plugin system):**

```bash
git clone https://github.com/jgorostegui/notion-agent-cli.git
cd notion-agent-cli
node scripts/setup.mjs
```

The setup script installs runtime dependencies if needed, prompts for your token, validates the connection, and saves auth in the plugin directory.

### 3. Run setup

One command:

```bash
node scripts/setup.mjs
```

That command will:

- install runtime dependencies if they are missing
- prompt for your Notion token
- validate the connection against Notion
- save the token to `.env` in the plugin directory

Optional non-interactive mode:

```bash
printf '%s\n' "ntn_your_token_here" | node scripts/setup.mjs --with-token
```

Runtime auth priority is: `NOTION_TOKEN` from the environment first, then `.env` in the plugin directory.

## Quick Start

```bash
node scripts/actions.mjs search "roadmap"
node scripts/actions.mjs getPage <pageId>
node scripts/actions.mjs queryDatabase <dbId>
node scripts/actions.mjs createPage <parentId> "Weekly Notes" "## Done\n- Shipped docs refresh"
```

## Common Workflows

Copy a page and add notes in one step:

```bash
node scripts/actions.mjs copyPageWith <sourcePageId> <targetParentId> "Updated Copy" '{"appendMd":"## Notes\nFollow-up items go here."}'
```

Replace one section without rebuilding the whole page:

```bash
node scripts/actions.mjs replaceSection <pageId> "Overview" "New overview content."
```

Update several entries at once:

```bash
node scripts/actions.mjs batchSetProperties '["id1","id2","id3"]' '{"Status":"Done"}'
```

## Benchmark Snapshot

The repository includes a controlled benchmark comparing Notion Agent CLI (NAC) with the official Notion MCP interface across 8 scenarios and 2 Claude models.

The current public snapshot is the March 16, 2026 comparison, with `n=5` runs per scenario and condition:

| Model | NAC avg turns | MCP avg turns | NAC total cost | MCP total cost | Saving |
|---|---:|---:|---:|---:|---:|
| Sonnet 4.6 | 2.5 | 5.9 | $1.74 | $7.17 | 76% |
| Opus 4.6 | 2.7 | 7.2 | $4.00 | $12.25 | 67% |

The gap is small on simple tasks and large on compound ones. The strongest savings show up when the model would otherwise have to fetch, transform, and write content over several turns. One notable exception remains: on Opus 4.6, the `Copy+Modify` scenario was effectively tied.

This benchmark is best read as interface-level evidence, not as a universal claim about all Notion work. The CLI condition uses prompt-injected skill content to equalize tool knowledge, and the benchmark runner still needs tighter automated correctness validation. The full report, including per-scenario tables, run IDs, and limitations, is in [EVALUATION.md](EVALUATION.md).

## Project Status

The plugin is usable today and the repository is in decent shape, but it is still early.

- Tests cover the converter layer, CLI dispatch, helpers, and a number of structural invariants.
- The benchmark harness is reproducible and stores raw transcripts.
- Safety is best-effort and centered on page content workflows, not full ACID-style rollback across every Notion mutation.
- Database and data-source paths still need more hardening against Notion API changes.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) explains the repository layout and the internal design choices.
- [EVALUATION.md](EVALUATION.md) is the benchmark report, with method, results, limitations, and exact scope.
- [benchmark/BENCHMARK.md](benchmark/BENCHMARK.md) shows how to reproduce the benchmark runs.
- [skills/notion-agent-cli/SKILL.md](skills/notion-agent-cli/SKILL.md) is the skill entry point used by Claude Code.
- [skills/notion-agent-cli/references/action-reference.md](skills/notion-agent-cli/references/action-reference.md) lists every action and its arguments.

## Requirements

- Node.js 18+
- A Notion integration token
- Access to the pages and databases you want the integration to touch

## License

MIT
