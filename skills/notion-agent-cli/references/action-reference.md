<!-- Generated from ACTION_CATALOG — do not edit manually -->
<!-- Run: node scripts/notion/docs/generate-skill-docs.mjs -->

# Notion Agent CLI — Full Reference

All actions are invoked via CLI:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs <action> [args...]
```

## READ Actions

| Action | Args | Description |
|---|---|---|
| `search` | `query, {type?}` | Search workspace pages/databases |
| `getPage` | `pageId, {format?}` | Get page content as markdown |
| `getDatabase` | `dbId` | Get database schema + all entries |
| `queryDatabase` | `dbId, {filter?}, {sorts?}, {limit?}, {format?}` | Query database (markdown table; --format raw for JSON) |
| `getTree` | `pageId, {depth?}` | Hierarchical page/database tree |
| `exportPage` | `pageId, path` | Save page as markdown file |
| `exportDatabase` | `dbId, path, {format?}` | Export as CSV or JSON |
| `getComments` | `pageId` | All comments on a page |
| `getUsers` | `` | All workspace users |
| `extractSection` | `pageId, headingText` | Get one section's markdown |

## WRITE Actions

| Action | Args | Description |
|---|---|---|
| `createPage` | `parentId, title, content?, {parentType?}` | Create page from markdown |
| `updatePage` | `pageId, content` | Replace all content (auto-snapshots) |
| `appendBlocks` | `pageId, content` | Append markdown to end of page |
| `insertBlocks` | `pageId, content, {after?}, {atHeading?}, {atStart?}` | Insert blocks at position |
| `setProperties` | `pageId, props` | Update page/entry properties (auto-typed) |
| `addComment` | `pageId, text` | Add comment to page |
| `lockPage` | `pageId` | Lock page |
| `unlockPage` | `pageId` | Unlock page |
| `createDatabase` | `parentId, title, schema` | Create database with schema |
| `addDatabaseEntry` | `dbId, values` | Add row with auto-typed properties |
| `importTable` | `parentId, content, {title?}` | Create database from markdown table (infers types) |

## STRUCTURAL Actions

| Action | Args | Description |
|---|---|---|
| `moveBlocks` | `sourcePageId, targetPageId, blockIds, {position?}` | Move blocks between pages with rollback |
| `movePage` | `pageId, newParentId, {parentType?}` | Move page (deep copy + archive) |
| `reorderBlocks` | `pageId, newOrder` | Reorder blocks by ID array |
| `deepCopy` | `sourcePageId, targetParentId` | Full recursive page copy |
| `copyPageWith` | `sourcePageId, targetParentId, title, {appendMd?}, {prependMd?}, {replaceTitle?}` | Read + modify + create in one call |
| `mergePages` | `sourcePageIds, targetPageId, {archiveSources?}` | Combine multiple pages into one |
| `splitPage` | `pageId, {headingLevel?}, {createUnderSamePage?}` | Split page at headings into subpages |
| `replaceSection` | `pageId, headingText, content` | Replace section content (auto-snapshots) |
| `flattenPage` | `pageId` | Inline subpages into parent |
| `nestUnderHeadings` | `pageId, {headingLevel?}` | Convert sections to subpages |
| `duplicateStructure` | `sourcePageId, targetParentId` | Copy hierarchy (empty pages) |
| `applyTemplate` | `templatePageId, targetParentId, variables` | Template with {{placeholders}} |

## BATCH Actions

| Action | Args | Description |
|---|---|---|
| `batchSetProperties` | `pageIds, props` | Update properties on multiple pages |
| `batchArchive` | `pageIds` | Archive multiple pages |
| `batchTag` | `pageIds, property, value` | Tag pages with select value |

## SAFETY Actions

| Action | Args | Description |
|---|---|---|
| `snapshot` | `pageId` | In-memory snapshot (max 20) |
| `restore` | `snapId` | Restore from snapshot |
| `backupPage` | `pageId, dirPath` | Recursive backup to disk |
| `backupDatabase` | `dbId, dirPath` | Export schema + entries to disk |
| `transact` | `operations` | Multi-op with rollback |

## ANALYSIS Actions

| Action | Args | Description |
|---|---|---|
| `workspaceMap` | `` | All pages and databases |
| `pageStats` | `pageId` | Block count, depth, word count |
| `diffPages` | `pageId1, pageId2` | Line-level page comparison |
| `findDuplicates` | `` | Pages with same title |
| `findOrphans` | `` | Root-level pages |
| `findEmpty` | `` | Pages with no content |
| `findStale` | `days?` | Pages not edited in N days |
| `suggestReorganization` | `pageId` | Structure improvement suggestions |

## Stdin Mode

Pipe JSON directly to avoid temp files:

```bash
echo '{"action": "createPage", "parentId": "abc", "title": "Title", "content": "markdown"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs -
```

## JSON Request File Format

For large content payloads, write a JSON file and pass it as the argument:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs /tmp/req.json
```

```json
{"action": "createPage", "parentId": "abc", "title": "My Page", "contentFile": "/tmp/content.md"}
{"action": "updatePage", "pageId": "abc", "contentFile": "/tmp/content.md"}
{"action": "replaceSection", "pageId": "abc", "headingText": "Intro", "content": "New intro text"}
{"action": "queryDatabase", "dbId": "abc", "filter": {"property": "Status", "select": {"equals": "Done"}}}
{"action": "setProperties", "pageId": "id", "props": {"Status": "Done", "Priority": "High"}}
```

## API Limits

- **Rate limit**: ~3 req/s (auto-enforced at 2.5 req/s)
- **100 blocks** max per append request (auto-chunked)
- **2000 chars** max per rich_text (auto-chunked)
- **2 levels** nesting per create request
- **5000 blocks** max per recursive fetch (silently truncates)
- Search is eventually consistent
- File URLs expire after ~1 hour
