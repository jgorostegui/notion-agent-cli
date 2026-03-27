# Notion API Limits & Gotchas

## Rate Limiting
- ~3 requests/second average. SDK auto-retries on 429 with exponential backoff (maxRetries: 3).
- ConcurrencyLimiter defaults to serial (concurrency=1) for normal operations.
- Bulk operations (importTable, _cloneDatabase, batchArchive) use _callBatch with concurrency=5.

## Size Limits
- **100 blocks** max per `blocks.children.append` request.
- **2000 characters** max per `rich_text` object. Auto-chunked by `textToRichText`.
- **2 levels** of block nesting per create/append request. Deeper nesting requires follow-up appends.

## Pagination
- All list endpoints return max 100 results per page. Use `start_cursor` for pagination.
- `_fetchBlocksRecursive` defaults to `maxBlocks: 5000` — silently truncates larger pages.

## Search
- Eventually consistent. Recently created pages may not appear immediately.
- Database filter value changed from `"database"` to `"data_source"` in API 2025-09-03.

## Position Parameter (SDK v5.8+)
```js
{ type: "end" }                                          // append at end
{ type: "start" }                                        // insert at start
{ type: "after_block", after_block: { id: blockId } }   // insert after block
```
- No `before_block` type exists. To insert before block N, use `after_block` with block N-1's ID.
- Old `after: "<block_id>"` body parameter is deprecated. Use `position` instead.

## File URLs
- File/image URLs (`file.file.url`) expire after ~1 hour.

## Empty Rich Text
- API rejects empty `rich_text` arrays. Always include at least: `[{ type: "text", text: { content: "" } }]`

## Undeletable/Uncreatable Block Types
- `child_page`: created via `pages.create`, not `blocks.children.append`.
- `child_database`: created via `databases.create`.
- `unsupported`: API can't represent certain internal block types.

## Data Sources (API 2025-09-03)
- Database IDs and data source IDs are NOT interchangeable.
- Use `databases.retrieve` to get `data_sources` list, then use the data source ID for queries, schema retrieval, and page creation.
- `dataSources.query({ data_source_id })` replaces deprecated `databases.query`.

## Archived vs In Trash
- `archived: true` — soft archive (recoverable in Notion UI).
- `in_trash: true` — trash (30-day auto-delete). Avoid using.
