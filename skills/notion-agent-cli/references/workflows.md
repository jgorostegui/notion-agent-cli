# Notion Agent CLI — Compound Workflow Recipes

Prefer compound actions over multi-step workflows. Each recipe below shows the single-call approach.

## Copy a Page with Modifications

Use `copyPageWith` to read a source page and create a modified copy in one call.

```bash
# Copy page and append a new section
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs copyPageWith <sourcePageId> <targetParentId> "New Title" '{"appendMd": "## Notes\nAdded by automation."}'

# Copy page and prepend content
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs copyPageWith <sourcePageId> <targetParentId> "New Title" '{"prependMd": "## Important\nThis is a copy."}'
```

Equivalent to: `getPage` → process content → `createPage` — but in 1 CLI call instead of 3.

## Merge Multiple Pages

Use `mergePages` to combine N pages into one target page. The target page must already exist — use `createPage` first to create it.

```bash
# Step 1: Create the target page
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs createPage <parentId> "Merged Report" ""

# Step 2: Merge source pages into the target (each source appended with H1 demoted to H2)
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs mergePages '["pageId1","pageId2","pageId3"]' <targetPageId> '{"archiveSources": true}'
```

This is a 2-step workflow: `createPage` -> `mergePages`. The merge reads each source and appends its content to the target.

Equivalent to: N × `getPage` + N × `appendBlocks` — but in 2 calls instead of 2N.

## Batch Update Properties

Use `batchSetProperties` to update the same properties on multiple pages/entries at once.

```bash
# Set Status on 3 entries
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs batchSetProperties '["entryId1","entryId2","entryId3"]' '{"Status": "Done"}'
```

Equivalent to: N × `setProperties` — but in 1 call.

## Replace a Section

Use `replaceSection` to surgically replace one section's content without touching the rest of the page.

```bash
# Replace the "Overview" section
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs replaceSection <pageId> "Overview" "New overview content with **formatting**."
```

Auto-snapshots before modifying. Equivalent to: `getPage` → find section → `delete blocks` → `insertBlocks` — but in 1 call.

## Full Recursive Copy

Use `deepCopy` to copy a page and all its subpages recursively.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs deepCopy <sourcePageId> <targetParentId>
```

Preserves the full page tree structure. Title is copied from the source.

## Split Page into Subpages

Use `splitPage` to break a page into subpages at heading boundaries.

```bash
# Split at H2 boundaries, create subpages under the same page
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs splitPage <pageId> '{"headingLevel": 2, "createUnderSamePage": true}'
```

## Move Blocks Between Pages

Use `moveBlocks` to transfer specific blocks from one page to another with automatic rollback on failure.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs moveBlocks <sourcePageId> <targetPageId> '["blockId1","blockId2"]'
```

## Template with Variable Substitution

Use `applyTemplate` to copy a template page and replace `{{placeholders}}` with values.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs applyTemplate <templatePageId> <targetParentId> '{"name": "Acme Corp", "date": "2026-03-05"}'
```

## Query Database and Create Report

Use `queryDatabase` to get all rows in one call, then `createPage` with the formatted results.

```bash
# Step 1: Get all entries (returns compact markdown table with row IDs)
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs queryDatabase <dbId>

# Step 2: Create report page with formatted content
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs createPage <parentId> "Report" "## Entries\n- Entry 1\n- Entry 2"
```

`queryDatabase` returns all rows as a compact markdown table with row IDs — no need
to fetch each row individually. The table shows up to 8 property columns; use
`--format raw` if you need the full JSON for programmatic use or to see all columns.

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
