/**
 * Notion Agent CLI — thin wrapper.
 * Loads .env, re-exports the programmatic barrel, and runs the CLI dispatcher.
 */

// Side effect: load .env before anything else
import "./notion/env.mjs";

// Explicit re-exports (30 public symbols)
export {
  _cloneMention,
  _clonePageCover,
  _clonePageIcon,
  _cloneRichTextArray,
  _sanitizeBlockForCreate,
  _splitDeepChildren,
  ACTIONS,
  blocksToMarkdown,
  buildPropertyValue,
  ConcurrencyLimiter,
  clonePropertyValue,
  csvEscape,
  extractDbTitle,
  extractPropertyValue,
  extractTitle,
  inferColumnTypes,
  isTableSeparator,
  makeCodeBlock,
  makeHeadingBlock,
  makeTextBlock,
  markdownToBlocks,
  NotionActions,
  normalizeId,
  parseMarkdownTableData,
  recreateBlock,
  richTextToMd,
  safeName,
  splitTableRow,
  textToRichText,
  toCamelCase,
} from "./notion/index.mjs";

import { main } from "./notion/cli/main.mjs";

// CLI execution guard
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
