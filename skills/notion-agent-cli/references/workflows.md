<!-- Generated from ACTION_CATALOG — do not edit manually -->
<!-- Run: node scripts/notion/docs/generate-skill-docs.mjs -->

# Notion Agent CLI — Compound Workflow Recipes

Prefer compound actions over multi-step workflows. Each recipe below shows the single-call approach.

## Query Database and Create Report

Use `queryDatabase` to query database (markdown table; --format raw for json).

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs queryDatabase abc123
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs queryDatabase abc123 --filter '{"property":"Status","select":{"equals":"Done"}}'
```

Returns compact markdown table with row IDs. Use --format raw for full JSON.

> **Note**: Returns markdown table by default, use --format raw for JSON

## Move Blocks Between Pages

Use `moveBlocks` to move blocks between pages with rollback.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs moveBlocks srcId targetId '["blockId1","blockId2"]'
```

## Full Recursive Copy

Use `deepCopy` to full recursive page copy.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs deepCopy srcPageId targetParentId
```

Preserves the full page tree structure. Title is copied from the source.

> **Note**: Use copyPageWith instead if you need to modify the copy

## Copy a Page with Modifications

Use `copyPageWith` to read + modify + create in one call.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs copyPageWith srcId parentId "New Title" --appendMd "## Notes\nAdded by automation."
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs copyPageWith srcId parentId "New Title" --prependMd "## Important\nThis is a copy."
```

Equivalent to: getPage + createPage (2 calls) — but in 1 CLI call.

## Merge Multiple Pages

Use `mergePages` to combine multiple pages into one.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs mergePages '["pageId1","pageId2","pageId3"]' targetId '{"archiveSources": true}'
```

Equivalent to: N x getPage + N x appendBlocks (2N calls) — but in 1 CLI call.

Target must already exist — use createPage first.

> **Note**: Target page must already exist — use createPage first

## Split Page into Subpages

Use `splitPage` to split page at headings into subpages.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs splitPage abc123 '{"headingLevel": 2, "createUnderSamePage": true}'
```

## Replace a Section

Use `replaceSection` to replace section content (auto-snapshots).

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs replaceSection abc123 "Overview" "New overview content with **formatting**."
```

Equivalent to: getPage + find section + delete blocks + insertBlocks (4 calls) — but in 1 CLI call.

Auto-snapshots before modifying.

## Template with Variable Substitution

Use `applyTemplate` to template with {{placeholders}}.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs applyTemplate templateId parentId '{"name":"Acme Corp","date":"2026-03-05"}'
```

Equivalent to: deepCopy + manual find-replace — but in 1 CLI call.

## Batch Update Properties

Use `batchSetProperties` to update properties on multiple pages.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs batchSetProperties '["id1","id2","id3"]' '{"Status":"Done"}'
```

Equivalent to: N x setProperties (N calls) — but in 1 CLI call.

## Large Content via Stdin

Pipe JSON directly to avoid creating temp files:

```bash
cat <<'EOF' | node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs -
{"action": "createPage", "parentId": "abc", "title": "My Page", "content": "## Full markdown content\n\nWith **formatting**, lists, code blocks, etc."}
EOF
```

For content stored in a file:

```bash
jq -n --arg content "$(cat /tmp/content.md)" '{"action":"createPage","parentId":"abc","title":"Title","content":$content}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs -
```
