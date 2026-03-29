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

### 1. Install the plugin

```bash
claude plugin marketplace add jgorostegui/notion-agent-cli
claude plugin install notion-agent-cli@notion-agent-cli-marketplace
```

Dependencies install automatically on first session start.

### 2. Set up authentication

Create a Notion integration at <https://www.notion.so/profile/integrations> and copy the token (starts with `ntn_`). Share the pages and databases you want to access with the integration (page menu > Connections > add it).

Then run `/notion-agent-cli:setup` inside Claude Code. It will ask for your token, validate it, and store it in `~/.claude/settings.json` where it persists across plugin updates.

Alternatively, add the token to your settings manually:

```json
{
  "env": {
    "NOTION_TOKEN": "ntn_your_token_here"
  }
}
```

### Manual install (no plugin system)

```bash
git clone https://github.com/jgorostegui/notion-agent-cli.git
cd notion-agent-cli
npm install
cp .env.example .env   # edit with your token
```

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

The repository includes a controlled benchmark comparing Notion Agent CLI with the official Notion MCP interface across 10 scenarios and 2 Claude models (Sonnet 4.6, Opus 4.6). The task-level interface consistently reduced both turn count and session cost, with the largest gains on compound workflows. The interface also provides a self-describing `schema` command so the model can look up exact action signatures without reading source code.

For per-scenario numbers, confidence intervals, and full methodology, see [EVALUATION.md](EVALUATION.md).

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

- Node.js 20+
- A Notion integration token
- Access to the pages and databases you want the integration to touch

## License

MIT
