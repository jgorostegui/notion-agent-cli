---
name: notion-agent-cli
description: >-
  Notion workspace operations via CLI. TRIGGER when the user asks to read, create,
  edit, copy, merge, split, move, query, search, archive, export, or batch-update
  Notion pages, databases, or properties — including "duplicate a page",
  "find duplicates", "compare pages", "replace a section", "add a comment",
  "apply a template", or "workspace map".
  DO NOT TRIGGER for general web scraping, non-Notion APIs, or discussion about
  this plugin's code and benchmarks.
version: 0.1.0
---

## CLI

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs <action> [args...]
```

Run actions directly. Do NOT read the script source or run `--help` unless the decision tree doesn't cover your case.

### Quick Patterns

- Read + summarize/report -> `getPage` -> `createPage` (2 calls)
- Copy with modifications -> `copyPageWith` (1 call)
- Merge pages -> `createPage` -> `mergePages` (2 calls)
- Batch property update -> `batchSetProperties` (1 call)

## Decision Tree

- **Find something** → `search "query"` or `workspaceMap`
- **Read a page** → `getPage <id>`
- **Read one section** → `extractSection <id> "Heading"`
- **Query a database** → `queryDatabase <dbId>` (markdown table; `--format raw` for JSON)
- **Create a page** → `createPage <parentId> "Title" "markdown content"`
- **Edit one section** → `replaceSection <id> "Heading" "new content"`
- **Replace all content** → `updatePage <id> "content"`
- **Add to end** → `appendBlocks <id> "content"`
- **Update properties** → `setProperties <id> '{"Status":"Done"}'`
- **Copy + modify** → `copyPageWith <src> <parent> "Title" --appendMd "## Extra"`
- **Merge pages** → `mergePages '["id1","id2"]' <target>`
- **Batch update** → `batchSetProperties '["id1","id2"]' '{"Status":"Done"}'`
- **Full copy with subpages** → `deepCopy <src> <parent>`
- **Markdown table → database** → `importTable <parentId> "| md | table |" --title "Name"` (infers column types)

## Key Behaviors

- **Page reads and database queries return markdown** by default.
  `getPage` and `extractSection` return markdown. `queryDatabase` returns a
  compact markdown table with row IDs for follow-up actions.
- **`setProperties` auto-types values** from the database schema.
  Pass `{"Status": "Done"}` — no raw Notion API format needed.
- **`createPage` accepts markdown** as the content argument.
- **Compound actions save turns** — each CLI call is one agentic turn:
  - `copyPageWith` = read + modify + create in 1 call
  - `mergePages` = N reads + merge in 1 call (target must exist; use `createPage` first)
  - `batchSetProperties` = N updates in 1 call
- **Stdin mode** for large content:
  `echo '{"action":"createPage",...}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs -`
- **Auto-snapshot** before destructive operations.

## Common Pitfalls

1. Do NOT fetch database entries individually — `queryDatabase` returns all in one call
2. Do NOT use `getPage` + `createPage` when `copyPageWith` does both in one call
3. Do NOT use multiple `setProperties` when `batchSetProperties` handles N pages
4. Do NOT read the script source — use `--help` or the references below

## References

- **`references/action-reference.md`** — Read when you need exact parameter names
  or options for an unfamiliar action. Lists all 47 actions.
- **`references/workflows.md`** — Read when combining operations or piping large
  content via stdin.
- **`references/api-limits.md`** — Read when hitting API errors, size limits, or unexpected behavior.
