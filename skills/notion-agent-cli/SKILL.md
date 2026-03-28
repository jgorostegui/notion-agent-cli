---
name: notion-agent-cli
description: >-
  Notion workspace operations via CLI. TRIGGER when the user asks to read, create,
  edit, copy, merge, split, move, query, search, archive, export, or batch-update
  Notion pages, databases, or properties — including "duplicate a page",
  "find duplicates", "compare pages", "replace a section", "add a comment",
  "apply a template", or "workspace map". Also trigger for casual requests like
  "what's in my Notion?", "update that database", "copy my meeting notes",
  "check for stale pages", or "show workspace overview".
  DO NOT TRIGGER for general web scraping, non-Notion APIs, or discussion about
  this plugin's implementation, source code, or repository internals.
version: 0.4.0
allowed-tools: "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs:*)"
---

## CLI

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs <action> [args...]
```

Run actions directly. If the decision tree does not cover your case, run `schema <action>` for live metadata. Prefer `schema` over reading source.

<!-- BEGIN GENERATED: quick-patterns -->
### Quick Patterns

- Read + summarize/report -> `getPage` -> `createPage` (2 calls)
- Copy with modifications -> `copyPageWith` (1 call)
- Merge pages -> `createPage` -> `mergePages` (2 calls)
- Batch property update -> `batchSetProperties` (1 call)
<!-- END GENERATED: quick-patterns -->

<!-- BEGIN GENERATED: decision-tree -->
## Decision Tree

- **Find something** -> `search "query"` or `workspaceMap`
- **Read a page** -> `getPage <id>`
- **Query a database** -> `queryDatabase <dbId>` (markdown table; `--format raw` for JSON)
- **Create a page** -> `createPage <parentId> "Title" "markdown content"`
- **Replace all content** -> `updatePage <id> "content"`
- **Add to end** -> `appendBlocks <id> "content"`
- **Update properties** -> `setProperties <id> '{"Status":"Done"}'`
- **Markdown table to database** -> `importTable <parentId> "| md | table |" --title "Name"` (infers column types)
- **Full copy with subpages** -> `deepCopy <src> <parent>`
- **Copy + modify** -> `copyPageWith <src> <parent> "Title" --appendMd "## Extra"`
- **Merge pages** -> `mergePages '["id1","id2"]' <target>`
- **Read one section** -> `extractSection <id> "Heading"`
- **Edit one section** -> `replaceSection <id> "Heading" "new content"`
- **Batch update** -> `batchSetProperties '["id1","id2"]' '{"Status":"Done"}'`
<!-- END GENERATED: decision-tree -->

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

<!-- BEGIN GENERATED: gotchas -->
## Common Pitfalls

1. Do NOT fetch database entries individually — `queryDatabase` returns all in one call
2. Do NOT use `getPage` + `createPage` when `copyPageWith` does both in one call
3. Do NOT use multiple `setProperties` when `batchSetProperties` handles N pages
4. Do NOT read the script source — use `schema <action>` or the references below
5. `mergePages` target must already exist — use `createPage` first to create it
6. Large content (>4KB) should use stdin mode, not inline CLI args
7. Properties are auto-typed from the database schema — pass simple values like `{"Status": "Done"}`, not raw Notion API format
8. File/image URLs expire after ~1 hour — re-fetch if reusing later
<!-- END GENERATED: gotchas -->

<!-- BEGIN GENERATED: references -->
## References

- **`references/action-reference.md`** — Read when you need exact parameter names or options for an unfamiliar action.
- **`references/workflows.md`** — Read when combining operations or piping large content via stdin.
- **`references/api-limits.md`** — Read when hitting API errors, size limits, or unexpected behavior.
<!-- END GENERATED: references -->
