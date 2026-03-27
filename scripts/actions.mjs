/**
 * Notion Agent CLI — 40+ high-level workspace operations
 * Single-file ES module: converters, class, helpers, CLI dispatcher.
 * API version 2025-09-03 · @notionhq/client ^5.9.0
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Client } from "@notionhq/client";

// Load .env from plugin root (replaces dotenv dependency)
try {
  const _pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(new URL(import.meta.url).pathname), "..");
  const env = await readFile(join(_pluginRoot, ".env"), "utf-8").catch(() => "");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
} catch {}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RateLimiter — 400ms minimum interval with promise-queue mutex
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class ConcurrencyLimiter {
  constructor(defaultConcurrency = 1) {
    this._max = defaultConcurrency;
    this._running = 0;
    this._queue = [];
  }

  async acquire() {
    if (this._running < this._max) {
      this._running++;
      return;
    }
    await new Promise((resolve) => this._queue.push(resolve));
  }

  release() {
    this._running--;
    if (this._queue.length > 0) {
      this._running++;
      this._queue.shift()();
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Converter Functions — Markdown ↔ Blocks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Convert Notion rich_text array to markdown. Annotation order: code→bold→italic→strike→underline→link */
function richTextToMd(richText) {
  if (!richText?.length) return "";
  return richText
    .map((rt) => {
      let text = rt.plain_text || "";
      const ann = rt.annotations || {};
      if (ann.code) text = `\`${text}\``;
      if (ann.bold) text = `**${text}**`;
      if (ann.italic) text = `*${text}*`;
      if (ann.strikethrough) text = `~~${text}~~`;
      if (ann.underline) text = `<u>${text}</u>`;
      const link = rt.href || rt.text?.link?.url;
      if (link) text = `[${text}](${link})`;
      return text;
    })
    .join("");
}

/** Convert block tree to markdown string */
function blocksToMarkdown(blocks, indent = 0) {
  const lines = [];
  const prefix = "  ".repeat(indent);

  for (const block of blocks) {
    const type = block.type || "unsupported";
    const content = block[type] || {};

    switch (type) {
      case "paragraph":
        lines.push(`${prefix}${richTextToMd(content.rich_text)}`);
        break;
      case "heading_1":
        lines.push(`${prefix}# ${richTextToMd(content.rich_text)}`);
        break;
      case "heading_2":
        lines.push(`${prefix}## ${richTextToMd(content.rich_text)}`);
        break;
      case "heading_3":
        lines.push(`${prefix}### ${richTextToMd(content.rich_text)}`);
        break;
      case "bulleted_list_item":
        lines.push(`${prefix}- ${richTextToMd(content.rich_text)}`);
        break;
      case "numbered_list_item":
        lines.push(`${prefix}1. ${richTextToMd(content.rich_text)}`);
        break;
      case "to_do":
        lines.push(`${prefix}- [${content.checked ? "x" : " "}] ${richTextToMd(content.rich_text)}`);
        break;
      case "toggle":
        lines.push(`${prefix}<details><summary>${richTextToMd(content.rich_text)}</summary>`);
        break;
      case "code":
        lines.push(`${prefix}\`\`\`${content.language || ""}`);
        lines.push(`${prefix}${richTextToMd(content.rich_text)}`);
        lines.push(`${prefix}\`\`\``);
        break;
      case "quote":
        lines.push(`${prefix}> ${richTextToMd(content.rich_text)}`);
        break;
      case "callout": {
        const icon = content.icon?.emoji || "💡";
        lines.push(`${prefix}> ${icon} ${richTextToMd(content.rich_text)}`);
        break;
      }
      case "divider":
        lines.push(`${prefix}---`);
        break;
      case "image": {
        const url = content.type === "external" ? content.external?.url : content.file?.url;
        const caption = richTextToMd(content.caption || []);
        lines.push(`${prefix}![${caption}](${url || ""})`);
        break;
      }
      case "bookmark":
        lines.push(`${prefix}[${content.url || ""}](${content.url || ""})`);
        break;
      case "child_page":
        lines.push(`${prefix}📄 **[Subpage: ${content.title || "Untitled"}]** (id: ${block.id})`);
        break;
      case "child_database":
        lines.push(`${prefix}🗃️ **[Database: ${content.title || "Untitled"}]** (id: ${block.id})`);
        break;
      case "table": {
        const tableRows = (block.children || []).filter((r) => r.type === "table_row");
        if (tableRows.length === 0) {
          lines.push(`${prefix}[Empty table]`);
          break;
        }
        for (let ri = 0; ri < tableRows.length; ri++) {
          const cells = (tableRows[ri].table_row?.cells || []).map((cell) => richTextToMd(cell));
          lines.push(`${prefix}| ${cells.join(" | ")} |`);
          if (ri === 0) lines.push(`${prefix}| ${cells.map(() => "---").join(" | ")} |`);
        }
        break;
      }
      case "table_row": {
        const cells = (content.cells || []).map((cell) => richTextToMd(cell));
        lines.push(`${prefix}| ${cells.join(" | ")} |`);
        break;
      }
      case "equation":
        lines.push(`${prefix}$${content.expression || ""}$`);
        break;
      case "column_list":
        lines.push(`${prefix}[Columns]`);
        break;
      case "column":
        lines.push(`${prefix}[Column]`);
        break;
      case "unsupported":
        lines.push(`${prefix}[Unsupported block type]`);
        break;
      default:
        lines.push(`${prefix}[${type}]`);
    }

    if (block.children?.length && type !== "table") {
      lines.push(blocksToMarkdown(block.children, indent + 1));
    }
    lines.push(""); // blank line between blocks
  }

  return lines.join("\n");
}

/** Clone a mention from API response shape to request shape (strips name, avatar_url, etc.) */
function _cloneMention(mention) {
  switch (mention.type) {
    case "user":
      return { type: "user", user: { id: mention.user.id } };
    case "page":
      return { type: "page", page: { id: mention.page.id } };
    case "database":
      return { type: "database", database: { id: mention.database.id } };
    case "date":
      return { type: "date", date: mention.date };
    case "template_mention":
      return { type: "template_mention", template_mention: mention.template_mention };
    default:
      return undefined;
  }
}

/** Clone a rich_text array from API response, preserving formatting, mentions, links, equations */
function _cloneRichTextArray(arr) {
  if (!arr?.length) return [{ type: "text", text: { content: "" } }];
  return arr
    .map((rt) => {
      const clone = { type: rt.type };
      if (rt.type === "text") {
        clone.text = { content: rt.text.content };
        if (rt.text.link) clone.text.link = rt.text.link;
      } else if (rt.type === "mention") {
        const m = _cloneMention(rt.mention);
        if (!m) {
          // link_preview/link_mention can't be created via API — convert to text with link
          const lm = rt.mention?.link_mention;
          const lp = rt.mention?.link_preview;
          const url = lp?.url || lm?.href || lm?.url;
          if (url) {
            // Use title from link_mention metadata if available, otherwise plain_text/URL
            const displayText = lm?.title || lp?.title || rt.plain_text || url;
            return { type: "text", text: { content: displayText, link: { url } } };
          }
          return null;
        }
        clone.mention = m;
      } else if (rt.type === "equation") {
        clone.equation = rt.equation;
      }
      if (rt.annotations) {
        const a = rt.annotations;
        if (a.bold || a.italic || a.strikethrough || a.underline || a.code || (a.color && a.color !== "default")) {
          clone.annotations = { ...a };
        }
      }
      return clone;
    })
    .filter(Boolean);
}

/** Convert plain text to rich_text array, auto-chunking at 2000 chars */
function textToRichText(text) {
  if (text === undefined || text === null || text === "") {
    return [{ type: "text", text: { content: "" } }];
  }
  const src = String(text);
  const spans = [];
  // Regex for inline markdown tokens (order matters: bold before italic)
  const inlineRe = /(\[([^\]]+)\]\(([^)]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(~~([^~]+)~~)/g;
  let last = 0;
  let m = inlineRe.exec(src);
  while (m !== null) {
    // Plain text before this match
    if (m.index > last) {
      pushChunked(spans, src.slice(last, m.index), {});
    }
    if (m[1]) {
      // Link: [text](url)
      pushChunked(spans, m[2], {}, m[3]);
    } else if (m[4]) {
      // Inline code: `text`
      pushChunked(spans, m[5], { code: true });
    } else if (m[6]) {
      // Bold: **text**
      pushChunked(spans, m[7], { bold: true });
    } else if (m[8]) {
      // Italic: *text*
      pushChunked(spans, m[9], { italic: true });
    } else if (m[10]) {
      // Strikethrough: ~~text~~
      pushChunked(spans, m[11], { strikethrough: true });
    }
    last = m.index + m[0].length;
    m = inlineRe.exec(src);
  }
  // Trailing plain text
  if (last < src.length) {
    pushChunked(spans, src.slice(last), {});
  }
  return spans.length ? spans : [{ type: "text", text: { content: "" } }];
}

/** Push rich_text spans, chunking at 2000 chars to respect Notion API limits */
function pushChunked(spans, content, annotations, href) {
  const ann = Object.keys(annotations).length
    ? {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: "default",
        ...annotations,
      }
    : undefined;
  let remaining = content;
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, 2000);
    remaining = remaining.slice(2000);
    const span = { type: "text", text: { content: chunk } };
    if (ann) span.annotations = ann;
    if (href) span.text.link = { url: href };
    spans.push(span);
  }
}

/** Parse markdown into Notion block objects */
function markdownToBlocks(md) {
  if (!md?.trim()) return [];
  const lines = md.split("\n");
  let i = 0;

  /** Return the indentation level (number of leading spaces) for a line */
  function indent(line) {
    const m = line.match(/^(\s*)/);
    return m ? m[1].length : 0;
  }

  /**
   * Collect consecutive indented list items as children of a parent block.
   * `minIndent` is the minimum indentation that counts as a child.
   */
  function collectChildren(minIndent) {
    const children = [];
    while (i < lines.length) {
      const ln = lines[i];
      const lvl = indent(ln);
      const stripped = ln.trim();
      if (!stripped || lvl < minIndent) break;
      // Must be a list item at this indent level
      const bulletChild = stripped.match(/^[-*]\s+(.*)/);
      const numChild = stripped.match(/^\d+\.\s+(.*)/);
      if (bulletChild) {
        const block = makeTextBlock("bulleted_list_item", bulletChild[1]);
        i++;
        const nested = collectChildren(lvl + 2);
        if (nested.length) block.bulleted_list_item.children = nested;
        children.push(block);
      } else if (numChild) {
        const block = makeTextBlock("numbered_list_item", numChild[1]);
        i++;
        const nested = collectChildren(lvl + 2);
        if (nested.length) block.numbered_list_item.children = nested;
        children.push(block);
      } else {
        break;
      }
    }
    return children;
  }

  const blocks = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    if (!trimmed) {
      i++;
      continue;
    }

    // Code block
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim() || "plain text";
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimEnd().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push(makeCodeBlock(codeLines.join("\n"), lang));
      continue;
    }

    const stripped = trimmed.trimStart();

    // To-do (must be before bullet)
    const todoMatch = stripped.match(/^-\s+\[([ x])\]\s+(.*)/);
    if (todoMatch) {
      blocks.push({
        object: "block",
        type: "to_do",
        to_do: { rich_text: textToRichText(todoMatch[2]), checked: todoMatch[1] === "x" },
      });
      i++;
      continue;
    }

    // Headings
    const headingMatch = stripped.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      blocks.push(makeHeadingBlock(headingMatch[1].length, headingMatch[2]));
      i++;
      continue;
    }

    // Bullet list (with nested children support)
    const bulletMatch = stripped.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      const parentIndent = indent(line);
      const block = makeTextBlock("bulleted_list_item", bulletMatch[1]);
      i++;
      const children = collectChildren(parentIndent + 2);
      if (children.length) block.bulleted_list_item.children = children;
      blocks.push(block);
      continue;
    }

    // Numbered list (with nested children support)
    const numMatch = stripped.match(/^\d+\.\s+(.*)/);
    if (numMatch) {
      const parentIndent = indent(line);
      const block = makeTextBlock("numbered_list_item", numMatch[1]);
      i++;
      const children = collectChildren(parentIndent + 2);
      if (children.length) block.numbered_list_item.children = children;
      blocks.push(block);
      continue;
    }

    // Quote
    if (stripped.startsWith("> ")) {
      blocks.push(makeTextBlock("quote", stripped.slice(2)));
      i++;
      continue;
    }

    // Divider
    if (/^(---|___|\*\*\*)$/.test(stripped)) {
      blocks.push({ object: "block", type: "divider", divider: {} });
      i++;
      continue;
    }

    // Equation
    if (trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length > 2) {
      blocks.push({
        object: "block",
        type: "equation",
        equation: { expression: trimmed.slice(1, -1) },
      });
      i++;
      continue;
    }

    // Table: detect pipe-delimited rows with separator
    if (splitTableRow(stripped) && i + 1 < lines.length && isTableSeparator(lines[i + 1].trim())) {
      const headerCells = splitTableRow(stripped);
      const numCols = headerCells.length;
      const tableChildren = [];

      // Header row
      tableChildren.push({
        object: "block",
        type: "table_row",
        table_row: { cells: headerCells.map((c) => textToRichText(c)) },
      });

      i += 2; // skip header + separator

      // Data rows
      while (i < lines.length) {
        const rowCells = splitTableRow(lines[i].trim());
        if (!rowCells) break;
        // Pad/truncate to numCols
        const padded = [];
        for (let c = 0; c < numCols; c++) {
          padded.push(rowCells[c] !== undefined ? rowCells[c] : "");
        }
        tableChildren.push({
          object: "block",
          type: "table_row",
          table_row: { cells: padded.map((c) => textToRichText(c)) },
        });
        i++;
      }

      blocks.push({
        object: "block",
        type: "table",
        table: {
          table_width: numCols,
          has_column_header: true,
          has_row_header: false,
          children: tableChildren,
        },
      });
      continue;
    }

    // Default: paragraph
    blocks.push(makeTextBlock("paragraph", trimmed));
    i++;
  }

  return blocks;
}

/** Block builder helpers */
function makeTextBlock(type, text) {
  return { object: "block", type, [type]: { rich_text: textToRichText(text) } };
}

function makeHeadingBlock(level, text) {
  const type = `heading_${level}`;
  return { object: "block", type, [type]: { rich_text: textToRichText(text) } };
}

function makeCodeBlock(code, language = "plain text") {
  return { object: "block", type: "code", code: { rich_text: textToRichText(code), language } };
}

/** Clone a block for create/append API. Strips read-only fields. Returns null for unsupported types. */
function recreateBlock(block, children = []) {
  const type = block.type;
  if (!type || type === "unsupported" || type === "child_page" || type === "child_database") return null;

  const newBlock = { object: "block", type };
  if (block[type]) {
    const content = { ...block[type] };
    for (const key of [
      "id",
      "created_time",
      "last_edited_time",
      "created_by",
      "last_edited_by",
      "archived",
      "in_trash",
      "parent",
    ]) {
      delete content[key];
    }
    newBlock[type] = content;
  }

  if (children.length > 0 && newBlock[type]) {
    const childBlocks = children
      .slice(0, 100)
      .map((c) => recreateBlock(c, c.children || []))
      .filter(Boolean);
    if (childBlocks.length > 0) newBlock[type].children = childBlocks;
  }

  return newBlock;
}

/** Sanitize a recreated block for the create/append API.
 *  - Chunks rich_text exceeding 2000-char API limit
 *  - Sanitizes rich_text mentions (link_preview/link_mention to text links)
 *  - Sanitizes caption mentions */
function _sanitizeBlockForCreate(block) {
  if (!block) return block;
  const type = block.type;
  if (!type || !block[type]) return block;
  const content = block[type];

  // Chunk rich_text elements exceeding 2000-char API limit
  if (Array.isArray(content.rich_text)) {
    const chunked = [];
    for (const rt of content.rich_text) {
      if (rt.type === "text" && rt.text?.content?.length > 2000) {
        const text = rt.text.content;
        for (let i = 0; i < text.length; i += 2000) {
          const chunk = { type: "text", text: { content: text.slice(i, i + 2000) } };
          if (rt.text.link) chunk.text.link = rt.text.link;
          if (rt.annotations) chunk.annotations = rt.annotations;
          chunked.push(chunk);
        }
      } else {
        chunked.push(rt);
      }
    }
    content.rich_text = chunked;
  }

  // Sanitize rich_text mentions in block content
  if (Array.isArray(content.rich_text)) {
    content.rich_text = _cloneRichTextArray(content.rich_text);
  }

  // Sanitize rich_text in caption (images, videos, etc.)
  if (Array.isArray(content.caption)) {
    content.caption = _cloneRichTextArray(content.caption);
  }

  return block;
}

/** Split deeply nested blocks for two-pass appending (Notion API allows max 2 levels per request).
 *  Returns { truncated, deferred } where truncated has max `maxDepth` levels and deferred
 *  records stripped children as { topIndex, childIndex, children }. */
function _splitDeepChildren(blocks, _maxDepth = 2) {
  const truncated = structuredClone(blocks);
  const deferred = [];
  for (let ti = 0; ti < truncated.length; ti++) {
    const block = truncated[ti];
    const type = block.type;
    if (!type || !block[type]?.children) continue;
    const children = block[type].children;
    for (let ci = 0; ci < children.length; ci++) {
      const child = children[ci];
      const childType = child.type;
      if (!childType || !child[childType]?.children) continue;
      deferred.push({ topIndex: ti, childIndex: ci, children: child[childType].children });
      delete child[childType].children;
    }
  }
  return { truncated, deferred };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pure Helper Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Extract readable title from a Notion page object */
function extractTitle(page) {
  const props = page.properties || {};
  for (const prop of Object.values(props)) {
    if (prop.type === "title") {
      return (prop.title || []).map((t) => t.plain_text || "").join("") || "Untitled";
    }
  }
  return "Untitled";
}

/** Extract readable title from a Notion database object */
function extractDbTitle(db) {
  return (db.title || []).map((t) => t.plain_text || "").join("") || "Untitled";
}

/** Convert any Notion property type to human-readable string (20 types) */
function extractPropertyValue(prop) {
  const t = prop?.type;
  if (!t) return "";
  switch (t) {
    case "title":
      return (prop.title || []).map((r) => r.plain_text).join("");
    case "rich_text":
      return (prop.rich_text || []).map((r) => r.plain_text).join("");
    case "number":
      return prop.number != null ? String(prop.number) : "";
    case "select":
      return prop.select?.name ?? "";
    case "multi_select":
      return (prop.multi_select || []).map((s) => s.name).join(", ");
    case "date":
      return prop.date?.start ?? "";
    case "checkbox":
      return String(prop.checkbox);
    case "url":
      return prop.url ?? "";
    case "email":
      return prop.email ?? "";
    case "phone_number":
      return prop.phone_number ?? "";
    case "status":
      return prop.status?.name ?? "";
    case "relation":
      return (prop.relation || []).map((r) => r.id.replace(/-/g, "").slice(-4)).join(", ");
    case "formula":
      return prop.formula?.[prop.formula?.type] != null ? String(prop.formula[prop.formula.type]) : "";
    case "rollup": {
      const s = JSON.stringify(prop.rollup);
      return s.length > 80 ? `${s.slice(0, 79)}…` : s;
    }
    case "people":
      return (prop.people || []).map((p) => p.name || p.id).join(", ");
    case "created_time":
      return prop.created_time ?? "";
    case "last_edited_time":
      return prop.last_edited_time ?? "";
    case "created_by":
      return prop.created_by?.name ?? "";
    case "last_edited_by":
      return prop.last_edited_by?.name ?? "";
    default:
      return JSON.stringify(prop[t] ?? "");
  }
}

/** Build typed Notion property objects from simple values (11 types) */
function buildPropertyValue(type, value) {
  switch (type) {
    case "title":
      return { title: [{ text: { content: String(value) } }] };
    case "rich_text":
      return { rich_text: [{ text: { content: String(value) } }] };
    case "number":
      return { number: Number(value) };
    case "select":
      return { select: { name: String(value) } };
    case "multi_select":
      return { multi_select: (Array.isArray(value) ? value : [value]).map((v) => ({ name: String(v) })) };
    case "checkbox":
      return { checkbox: Boolean(value) };
    case "url":
      return { url: String(value) };
    case "email":
      return { email: String(value) };
    case "date":
      return { date: { start: String(value) } };
    case "status":
      return { status: { name: String(value) } };
    case "relation":
      return { relation: (Array.isArray(value) ? value : [value]).map((v) => ({ id: String(v) })) };
    default:
      return {};
  }
}

/** Clone a property value from API response to request shape (bypasses buildPropertyValue) */
function clonePropertyValue(prop) {
  const type = prop?.type;
  if (!type) return undefined;
  switch (type) {
    case "title":
      return { title: _cloneRichTextArray(prop.title) };
    case "rich_text":
      return { rich_text: _cloneRichTextArray(prop.rich_text) };
    case "number":
      return prop.number != null ? { number: prop.number } : undefined;
    case "select":
      return prop.select ? { select: { name: prop.select.name } } : undefined;
    case "multi_select":
      return { multi_select: (prop.multi_select || []).map((s) => ({ name: s.name })) };
    case "checkbox":
      return { checkbox: prop.checkbox };
    case "url":
      return prop.url != null ? { url: prop.url } : undefined;
    case "email":
      return prop.email != null ? { email: prop.email } : undefined;
    case "phone_number":
      return prop.phone_number != null ? { phone_number: prop.phone_number } : undefined;
    case "status":
      return prop.status ? { status: { name: prop.status.name } } : undefined;
    case "date":
      return prop.date ? { date: prop.date } : undefined;
    case "people":
      return prop.people?.length ? { people: prop.people.map((p) => ({ id: p.id })) } : undefined;
    default:
      return undefined;
  }
}

/** Clone page icon. Passes through emoji/external/custom_emoji/icon types. File type needs re-upload. */
function _clonePageIcon(icon) {
  if (!icon) return undefined;
  if (icon.type === "emoji" || icon.type === "external" || icon.type === "custom_emoji" || icon.type === "icon")
    return icon;
  // type === "file": needs _reuploadNotionFile (handled by caller)
  return undefined;
}

/** Clone page cover. Passes through external type. File type needs re-upload via caller. */
function _clonePageCover(cover) {
  if (!cover) return undefined;
  if (cover.type === "external") return cover;
  // type === "file": needs _reuploadNotionFile (handled by caller)
  return undefined;
}

/** Normalize ID: 32-char hex → hyphenated UUID, already-hyphenated unchanged, idempotent */
function normalizeId(id) {
  if (!id || typeof id !== "string") return id;
  const clean = id.replace(/-/g, "");
  if (clean.length !== 32) return id;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

/** Sanitize filename: max 50 chars, alphanumeric/spaces/hyphens only */
function safeName(str) {
  return str
    .replace(/[^\w\s-]/g, "")
    .trim()
    .slice(0, 50)
    .trim();
}

/** Escape a value for CSV: quote, double-escape inner quotes, replace newlines */
function csvEscape(value) {
  const str = String(value ?? "");
  return `"${str.replace(/"/g, '""').replace(/[\r\n]+/g, " ")}"`;
}

// ── Table Parsing Helpers ──────────────────────────────────────────────────────

/** Split a pipe-delimited markdown table row into trimmed cell strings. Returns null if not a table row. */
function splitTableRow(line) {
  const trimmed = line?.trim();
  if (!trimmed || !trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  // Split on |, drop first and last empty segments
  const parts = trimmed.split("|");
  return parts.slice(1, -1).map((c) => c.trim());
}

/** Returns true if the line is a markdown table separator row (e.g. | --- | :---: | ---: |) */
function isTableSeparator(line) {
  const cells = splitTableRow(line);
  if (!cells || cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c));
}

/** Parse a markdown table string into headers and rows. Returns null if no valid table found.
 *  Normalizes blank/duplicate headers. Pads short rows, truncates long rows. */
function parseMarkdownTableData(md) {
  if (!md?.trim()) return null;
  const lines = md.trim().split("\n");

  // Find first table row
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (splitTableRow(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  // Need at least header + separator
  if (start + 1 >= lines.length) return null;
  if (!isTableSeparator(lines[start + 1])) return null;

  const rawHeaders = splitTableRow(lines[start]);
  const colCount = rawHeaders.length;

  // Header normalization: blank → Column N, duplicates → Name 2, Name 3
  const seen = new Map();
  const headers = rawHeaders.map((h, i) => {
    let name = h || `Column ${i + 1}`;
    if (seen.has(name)) {
      const count = seen.get(name) + 1;
      seen.set(name, count);
      name = `${name} ${count}`;
    } else {
      seen.set(name, 1);
    }
    return name;
  });

  // Collect data rows (skip separator at start+1)
  const rows = [];
  for (let i = start + 2; i < lines.length; i++) {
    const cells = splitTableRow(lines[i]);
    if (!cells) break; // end of table
    // Pad/truncate to colCount
    const row = [];
    for (let c = 0; c < colCount; c++) {
      row.push(cells[c] !== undefined ? cells[c] : "");
    }
    rows.push(row);
  }

  return { headers, rows };
}

/** Infer Notion property types from column data. Best-effort heuristics.
 *  Returns Record<string, string> mapping header name to property type. */
function inferColumnTypes(headers, rows) {
  const types = {};
  for (let col = 0; col < headers.length; col++) {
    const header = headers[col];

    // First column is always title
    if (col === 0) {
      types[header] = "title";
      continue;
    }

    // Collect non-empty values
    const values = rows.map((r) => r[col]).filter((v) => v !== "" && v !== undefined && v !== null);

    if (values.length === 0) {
      types[header] = "rich_text";
      continue;
    }

    // Test in priority order
    if (values.every((v) => /^https?:\/\/.+/.test(v))) {
      types[header] = "url";
    } else if (values.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) {
      types[header] = "date";
    } else if (values.every((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))) {
      types[header] = "email";
    } else if (values.every((v) => /^(true|false|yes|no)$/i.test(v))) {
      types[header] = "checkbox";
    } else if (values.every((v) => /^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v))) {
      types[header] = "number";
    } else {
      // Check for select: at least one repeat, unique count <= 10
      const unique = new Set(values);
      if (unique.size <= 10 && unique.size < values.length) {
        types[header] = "select";
      } else {
        types[header] = "rich_text";
      }
    }
  }
  return types;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NotionActions Class
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class NotionActions {
  constructor(token) {
    const t = token || process.env.NOTION_TOKEN;
    if (!t)
      throw new Error("Notion token required. Run /notion-agent-cli:setup or set NOTION_TOKEN in the environment.");
    this.client = new Client({ auth: t, notionVersion: "2025-09-03", retry: { maxRetries: 3 } });
    this._limiter = new ConcurrencyLimiter(1);
    this._snapshots = new Map();
    this._dsCache = new Map();
    this._verbose = !!(process.env.DEBUG || process.env.VERBOSE);
    this._apiCallCount = 0;
  }

  // ── Internal Methods ──────────────────────────────────────────────────────

  /** Route every SDK call through ConcurrencyLimiter */
  async _call(fn) {
    await this._limiter.acquire();
    try {
      this._apiCallCount++;
      if (this._verbose) {
        const name = fn.name || "anonymous";
        process.stderr.write(`[notion] ${name}\n`);
      }
      return await fn();
    } finally {
      this._limiter.release();
    }
  }

  /** Run tasks concurrently with a concurrency limit. Returns array of { ok, value } or { ok, error }. */
  async _callBatch(tasks, concurrency = 5) {
    const limiter = new ConcurrencyLimiter(concurrency);
    const results = [];
    const promises = tasks.map(async (fn, i) => {
      await limiter.acquire();
      try {
        this._apiCallCount++;
        if (this._verbose) {
          const name = fn.name || "anonymous";
          process.stderr.write(`[notion] batch ${name}\n`);
        }
        results[i] = { ok: true, value: await fn() };
      } catch (e) {
        results[i] = { ok: false, error: e };
      } finally {
        limiter.release();
      }
    });
    await Promise.all(promises);
    return results;
  }

  /** Re-upload a Notion-hosted file via the File Upload API.
   *  Downloads from the presigned URL, uploads via fileUploads.create + send.
   *  Returns { type: "file_upload", file_upload: { id } } or undefined on failure. */
  async _reuploadNotionFile(fileUrl) {
    try {
      // Download the file from the presigned S3 URL
      const resp = await fetch(fileUrl);
      if (!resp.ok) return undefined;
      const contentType = resp.headers.get("content-type") || "application/octet-stream";
      const blob = await resp.blob();

      // Guess filename from URL path
      const urlPath = new URL(fileUrl).pathname;
      const filename = decodeURIComponent(urlPath.split("/").pop() || "file");

      // Create file upload object
      const upload = await this._call(() =>
        this.client.fileUploads.create({ mode: "single_part", filename, content_type: contentType }),
      );

      // Send file bytes
      await this._call(() =>
        this.client.fileUploads.send({ file_upload_id: upload.id, file: { filename, data: blob } }),
      );

      return { type: "file_upload", file_upload: { id: upload.id } };
    } catch {
      return undefined;
    }
  }

  /** Paginate blocks.children.list — shallow (immediate children only) */
  async _fetchBlocksShallow(blockId) {
    const results = [];
    let cursor;
    do {
      const resp = await this._call(() =>
        this.client.blocks.children.list({ block_id: normalizeId(blockId), page_size: 100, start_cursor: cursor }),
      );
      results.push(...resp.results);
      cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);
    return results;
  }

  /** Recursively fetch nested block trees. Skips child_page/child_database. Stops at maxBlocks. */
  async _fetchBlocksRecursive(blockId, { maxBlocks = 5000 } = {}) {
    let total = 0;
    const recurse = async (id) => {
      const blocks = await this._fetchBlocksShallow(id);
      total += blocks.length;
      if (total > maxBlocks) return blocks;
      for (const block of blocks) {
        if (block.has_children && block.type !== "child_page" && block.type !== "child_database") {
          block.children = await recurse(block.id);
          if (total > maxBlocks) break;
        }
      }
      return blocks;
    };
    return recurse(normalizeId(blockId));
  }

  /** Resolve database ID → data source ID (cached). Required for API 2025-09-03.
   *  Also accepts a data source ID directly (returns it as-is after verification). */
  async _resolveDataSourceId(dbId) {
    const nid = normalizeId(dbId);
    if (this._dsCache.has(nid)) return this._dsCache.get(nid);
    try {
      const db = await this._call(() => this.client.databases.retrieve({ database_id: nid }));
      const dsId = db.data_sources?.[0]?.data_source_id || db.data_sources?.[0]?.id || nid;
      this._dsCache.set(nid, dsId);
      return dsId;
    } catch {
      // ID might be a data source ID — verify it and use directly
      await this._call(() => this.client.dataSources.retrieve({ data_source_id: nid }));
      this._dsCache.set(nid, nid);
      return nid;
    }
  }

  /** Paginate dataSources.query per API 2025-09-03 */
  async _paginateQuery(dataSourceId, { filter, sorts, limit } = {}) {
    const results = [];
    let cursor;
    do {
      const params = { data_source_id: dataSourceId, page_size: 100, start_cursor: cursor };
      if (filter) params.filter = filter;
      if (sorts) params.sorts = sorts;
      const resp = await this._call(() => this.client.dataSources.query(params));
      results.push(...resp.results);
      cursor = resp.has_more ? resp.next_cursor : undefined;
      if (limit && results.length >= limit) {
        results.length = limit;
        break;
      }
    } while (cursor);
    return results;
  }

  /** Append blocks in chunks of 100. Returns created block IDs. */
  async _appendInBatches(pageId, blocks) {
    const nid = normalizeId(pageId);
    const allIds = [];
    for (let i = 0; i < blocks.length; i += 100) {
      const chunk = blocks.slice(i, i + 100);
      const resp = await this._call(() => this.client.blocks.children.append({ block_id: nid, children: chunk }));
      allIds.push(...resp.results.map((r) => r.id));
    }
    return allIds;
  }

  /** Append blocks with deep nesting support (two-pass). Returns created top-level block IDs. */
  async _appendWithDeepChildren(parentId, blocks) {
    const { truncated, deferred } = _splitDeepChildren(blocks, 2);
    if (deferred.length === 0) {
      return this._appendInBatches(parentId, truncated);
    }
    const createdIds = await this._appendInBatches(parentId, truncated);

    const byTop = new Map();
    for (const d of deferred) {
      if (!byTop.has(d.topIndex)) byTop.set(d.topIndex, []);
      byTop.get(d.topIndex).push(d);
    }
    for (const [topIdx, entries] of byTop) {
      const parentBlockId = createdIds[topIdx];
      const children = await this._fetchBlocksShallow(parentBlockId);
      for (const { childIndex, children: deepChildren } of entries) {
        await this._appendWithDeepChildren(children[childIndex].id, deepChildren);
      }
    }
    return createdIds;
  }

  /** Positional append with deep nesting support. Returns created block IDs. */
  async _appendAtPositionWithDeepChildren(parentId, blocks, position) {
    const { truncated, deferred } = _splitDeepChildren(blocks, 2);
    const createdIds = await this._appendAtPosition(parentId, truncated, position);
    if (deferred.length === 0) return createdIds;

    const byTop = new Map();
    for (const d of deferred) {
      if (!byTop.has(d.topIndex)) byTop.set(d.topIndex, []);
      byTop.get(d.topIndex).push(d);
    }
    for (const [topIdx, entries] of byTop) {
      const parentBlockId = createdIds[topIdx];
      const children = await this._fetchBlocksShallow(parentBlockId);
      for (const { childIndex, children: deepChildren } of entries) {
        await this._appendWithDeepChildren(children[childIndex].id, deepChildren);
      }
    }
    return createdIds;
  }

  /** Positional insertion with multi-batch chaining. Returns created block IDs. */
  async _appendAtPosition(pageId, blocks, position) {
    const nid = normalizeId(pageId);
    const createdIds = [];
    let pos = position || { type: "end" };

    for (let i = 0; i < blocks.length; i += 100) {
      const chunk = blocks.slice(i, i + 100);
      try {
        const resp = await this._call(() =>
          this.client.blocks.children.append({ block_id: nid, children: chunk, position: pos }),
        );
        const ids = resp.results.map((r) => r.id);
        createdIds.push(...ids);
        // Chain: next chunk goes after the last created block
        if (ids.length > 0) {
          pos = { type: "after_block", after_block: { id: ids[ids.length - 1] } };
        }
      } catch (e) {
        // Fallback: if after_block fails on empty page, try end
        if (pos.type === "after_block") {
          pos = { type: "end" };
          const resp = await this._call(() =>
            this.client.blocks.children.append({ block_id: nid, children: chunk, position: pos }),
          );
          const ids = resp.results.map((r) => r.id);
          createdIds.push(...ids);
          if (ids.length > 0) {
            pos = { type: "after_block", after_block: { id: ids[ids.length - 1] } };
          }
        } else {
          throw e;
        }
      }
    }
    return createdIds;
  }

  // ── READ Actions ────────────────────────────────────────────────────────

  /** Search workspace. type: "page" or "data_source" */
  async search(query, { type } = {}) {
    const params = { query: query || "", page_size: 100 };
    if (type) params.filter = { value: type, property: "object" };
    const results = [];
    let cursor;
    do {
      const resp = await this._call(() => this.client.search({ ...params, start_cursor: cursor }));
      results.push(...resp.results);
      cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);
    return results.map((r) => ({
      id: r.id,
      type: r.object,
      title: r.object === "page" ? extractTitle(r) : extractDbTitle(r),
      url: r.url,
      lastEdited: r.last_edited_time,
      parent: r.parent,
    }));
  }

  /** Get page content. Default: markdown string. format:"blocks" returns raw block tree. */
  async getPage(pageId, { format = "markdown" } = {}) {
    const nid = normalizeId(pageId);
    const blocks = await this._fetchBlocksRecursive(nid);
    const page = await this._call(() => this.client.pages.retrieve({ page_id: nid }));
    if (format === "blocks") {
      return { title: extractTitle(page), blocks };
    }
    return `# ${extractTitle(page)}\n\n${blocksToMarkdown(blocks)}`;
  }

  /** Get database schema + entries. Resolves data source ID per API 2025-09-03. */
  async getDatabase(dbId) {
    const nid = normalizeId(dbId);
    const dsId = await this._resolveDataSourceId(nid);
    const db = await this._call(() => this.client.databases.retrieve({ database_id: nid }));
    const entries = await this._paginateQuery(dsId);
    return { title: extractDbTitle(db), schema: db.properties, entries, entryCount: entries.length };
  }

  /** Filtered/sorted database query. Resolves data source ID. */
  async queryDatabase(dbId, { filter, sorts, limit } = {}) {
    const dsId = await this._resolveDataSourceId(normalizeId(dbId));
    return this._paginateQuery(dsId, { filter, sorts, limit });
  }

  /** Hierarchical tree of pages/databases up to depth. */
  async getTree(pageId, { depth = 3, _current = 0 } = {}) {
    const nid = normalizeId(pageId);
    const page = await this._call(() => this.client.pages.retrieve({ page_id: nid }));
    const tree = { id: nid, title: extractTitle(page), type: "page", children: [] };
    if (_current >= depth) return tree;
    const blocks = await this._fetchBlocksShallow(nid);
    for (const block of blocks) {
      if (block.type === "child_page") {
        tree.children.push(await this.getTree(block.id, { depth, _current: _current + 1 }));
      } else if (block.type === "child_database") {
        tree.children.push({
          id: block.id,
          title: block.child_database?.title || "Untitled",
          type: "database",
          children: [],
        });
      }
    }
    return tree;
  }

  /** Export page as markdown file */
  async exportPage(pageId, path) {
    const md = await this.getPage(normalizeId(pageId));
    await mkdir(dirname(path), { recursive: true }).catch(() => {});
    await writeFile(path, md, "utf-8");
    return path;
  }

  /** Export database as CSV or JSON */
  async exportDatabase(dbId, path, { format = "csv" } = {}) {
    const data = await this.getDatabase(normalizeId(dbId));
    await mkdir(path, { recursive: true }).catch(() => {});

    if (format === "json") {
      const filePath = join(path, "entries.json");
      const rows = data.entries.map((entry) => {
        const row = { _id: entry.id };
        for (const [name, prop] of Object.entries(entry.properties || {})) row[name] = extractPropertyValue(prop);
        return row;
      });
      await writeFile(filePath, JSON.stringify(rows, null, 2), "utf-8");
      return filePath;
    }

    // CSV
    const filePath = join(path, "entries.csv");
    const rows = data.entries.map((entry) => {
      const row = {};
      for (const [name, prop] of Object.entries(entry.properties || {})) row[name] = extractPropertyValue(prop);
      return row;
    });
    if (rows.length > 0) {
      const headers = Object.keys(rows[0]);
      const csvLines = [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))];
      await writeFile(filePath, csvLines.join("\n"), "utf-8");
    } else {
      await writeFile(filePath, "", "utf-8");
    }
    return filePath;
  }

  /** Get all comments on a page */
  async getComments(pageId) {
    const nid = normalizeId(pageId);
    const results = [];
    let cursor;
    do {
      const resp = await this._call(() =>
        this.client.comments.list({ block_id: nid, page_size: 100, start_cursor: cursor }),
      );
      results.push(...resp.results);
      cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);
    return results;
  }

  /** Get all workspace users */
  async getUsers() {
    const results = [];
    let cursor;
    do {
      const resp = await this._call(() => this.client.users.list({ page_size: 100, start_cursor: cursor }));
      results.push(...resp.results);
      cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);
    return results;
  }

  // ── WRITE Actions ───────────────────────────────────────────────────────

  /** Create page from markdown. parentType: "page" (default) or "database". */
  async createPage(parentId, title, contentMd, { parentType = "page" } = {}) {
    try {
      const nid = normalizeId(parentId);
      const blocks = contentMd ? markdownToBlocks(contentMd) : [];
      const firstBatch = blocks.slice(0, 100);
      const remaining = blocks.slice(100);

      let parent;
      if (parentType === "database") {
        const dsId = await this._resolveDataSourceId(nid);
        parent = { data_source_id: dsId };
      } else {
        parent = { page_id: nid };
      }

      const { deferred: firstDeferred } = _splitDeepChildren(firstBatch, 2);
      let page;
      if (firstDeferred.length === 0) {
        page = await this._call(() =>
          this.client.pages.create({
            parent,
            properties: { title: [{ text: { content: title || "" } }] },
            children: firstBatch,
          }),
        );
        if (remaining.length > 0) await this._appendWithDeepChildren(page.id, remaining);
      } else {
        page = await this._call(() =>
          this.client.pages.create({
            parent,
            properties: { title: [{ text: { content: title || "" } }] },
            children: [],
          }),
        );
        await this._appendWithDeepChildren(page.id, blocks);
      }
      return { success: true, pageId: page.id, url: page.url };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Replace all page content. Auto-snapshots unless _skipSnapshot. Skips child_page/child_database deletion. */
  async updatePage(pageId, contentMd, { _skipSnapshot = false } = {}) {
    const nid = normalizeId(pageId);
    try {
      if (!_skipSnapshot) await this.snapshot(nid);
      const existing = await this._fetchBlocksShallow(nid);
      for (const block of existing) {
        if (block.type === "child_page" || block.type === "child_database") continue;
        await this._call(() => this.client.blocks.delete({ block_id: block.id })).catch(() => {});
      }
      const blocks = markdownToBlocks(contentMd);
      await this._appendWithDeepChildren(nid, blocks);
      return { success: true, pageId: nid };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Append markdown to end of page */
  async appendBlocks(pageId, contentMd) {
    try {
      const nid = normalizeId(pageId);
      const blocks = markdownToBlocks(contentMd);
      await this._appendWithDeepChildren(nid, blocks);
      return { success: true, pageId: nid };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Insert content at position. Supports after, atHeading, atStart. */
  async insertBlocks(pageId, contentMd, { after, atHeading, atStart } = {}) {
    const nid = normalizeId(pageId);
    try {
      const blocks = markdownToBlocks(contentMd);

      // Resolve atHeading to block ID
      if (atHeading && !after) {
        const existing = await this._fetchBlocksShallow(nid);
        for (const block of existing) {
          const t = block.type;
          if (t?.startsWith("heading_")) {
            const text = richTextToMd(block[t]?.rich_text);
            if (text.toLowerCase().includes(atHeading.toLowerCase())) {
              after = block.id;
              break;
            }
          }
        }
        if (!after) return { success: false, error: "Heading not found" };
      }

      let position;
      if (after) {
        position = { type: "after_block", after_block: { id: normalizeId(after) } };
      } else if (atStart) {
        position = { type: "start" };
      } else {
        position = { type: "end" };
      }

      const blockIds = await this._appendAtPositionWithDeepChildren(nid, blocks, position);
      return { success: true, blockIds };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Update page properties */
  async setProperties(pageId, props) {
    try {
      const nid = normalizeId(pageId);
      // Auto-detect property types from parent DB schema when simple values are given
      const page = await this._call(() => this.client.pages.retrieve({ page_id: nid }));
      const parentType = page.parent?.type;
      let properties = props;
      if (parentType === "database_id" || parentType === "data_source_id") {
        const dsId = page.parent.data_source_id || (await this._resolveDataSourceId(page.parent.database_id));
        const ds = await this._call(() => this.client.dataSources.retrieve({ data_source_id: dsId }));
        properties = {};
        for (const [name, value] of Object.entries(props)) {
          const propSchema = ds.properties?.[name];
          const isSimple = typeof value === "string" || typeof value === "number" || typeof value === "boolean";
          if (propSchema && isSimple) {
            properties[name] = buildPropertyValue(propSchema.type, value);
          } else {
            properties[name] = value; // already in Notion API format
          }
        }
      }
      await this._call(() => this.client.pages.update({ page_id: nid, properties }));
      return { success: true, pageId: nid };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Add comment to page */
  async addComment(pageId, text) {
    try {
      const nid = normalizeId(pageId);
      await this._call(() =>
        this.client.comments.create({
          parent: { page_id: nid },
          rich_text: textToRichText(text),
        }),
      );
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Lock page */
  async lockPage(pageId) {
    try {
      const nid = normalizeId(pageId);
      await this._call(() => this.client.pages.update({ page_id: nid, is_locked: true }));
      return { success: true, pageId: nid };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Unlock page */
  async unlockPage(pageId) {
    try {
      const nid = normalizeId(pageId);
      await this._call(() => this.client.pages.update({ page_id: nid, is_locked: false }));
      return { success: true, pageId: nid };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Create database with schema. Wraps in initial_data_source per API 2025-09-03. */
  async createDatabase(parentId, title, schema) {
    try {
      const nid = normalizeId(parentId);
      const db = await this._call(() =>
        this.client.databases.create({
          parent: { type: "page_id", page_id: nid },
          title: [{ text: { content: title || "" } }],
          initial_data_source: { properties: schema },
        }),
      );
      return { success: true, databaseId: db.id, url: db.url };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Clone a database: schema + rows + row page bodies. Does not remap relation properties (v2).
   *  Row page content (child blocks) is copied via _deepCopyBlocks. */
  async _cloneDatabase(sourceDbId, targetParentId) {
    const srcId = normalizeId(sourceDbId);
    const tgtId = normalizeId(targetParentId);
    try {
      // Get source database metadata
      const db = await this._call(() => this.client.databases.retrieve({ database_id: srcId }));

      // Get source schema via data source (empty databases have no data sources)
      if (!db.data_sources?.length) {
        // Empty database — clone shell with metadata (no schema, no rows)
        const createPayload = {
          parent: { type: "page_id", page_id: tgtId },
          title: db.title?.length ? _cloneRichTextArray(db.title) : [{ text: { content: "" } }],
          initial_data_source: { properties: {} },
        };
        if (db.description?.length) createPayload.description = _cloneRichTextArray(db.description);
        let emptyIcon = _clonePageIcon(db.icon);
        if (!emptyIcon && db.icon?.type === "file" && db.icon.file?.url) {
          emptyIcon = await this._reuploadNotionFile(db.icon.file.url);
        }
        if (emptyIcon) createPayload.icon = emptyIcon;
        let emptyCover = _clonePageCover(db.cover);
        if (!emptyCover && db.cover?.type === "file" && db.cover.file?.url) {
          emptyCover = await this._reuploadNotionFile(db.cover.file.url);
        }
        if (emptyCover) createPayload.cover = emptyCover;
        if (db.is_inline) createPayload.is_inline = true;
        const newDb = await this._call(() => this.client.databases.create(createPayload));
        return {
          success: true,
          databaseId: newDb.id,
          url: newDb.url,
          entriesCloned: 0,
          rowIdMap: new Map(),
          errors: [],
        };
      }
      const dsId = await this._resolveDataSourceId(srcId);
      const ds = await this._call(() => this.client.dataSources.retrieve({ data_source_id: dsId }));

      // Build cloneable schema (skip computed/read-only and relation types)
      const SKIP_SCHEMA_TYPES = new Set([
        "formula",
        "rollup",
        "created_time",
        "created_by",
        "last_edited_time",
        "last_edited_by",
        "unique_id",
      ]);
      const schema = {};
      const cloneableProps = [];
      for (const [name, prop] of Object.entries(ds.properties || {})) {
        if (SKIP_SCHEMA_TYPES.has(prop.type)) continue;
        schema[name] = { [prop.type]: prop[prop.type] || {} };
        cloneableProps.push([name, prop.type]);
      }

      // Create target database with metadata (rich text title, icon, cover, description)
      const createPayload = {
        parent: { type: "page_id", page_id: tgtId },
        title: db.title?.length ? _cloneRichTextArray(db.title) : [{ text: { content: "" } }],
        initial_data_source: { properties: schema },
      };
      if (db.description?.length) createPayload.description = _cloneRichTextArray(db.description);
      let dbIcon = _clonePageIcon(db.icon);
      if (!dbIcon && db.icon?.type === "file" && db.icon.file?.url) {
        dbIcon = await this._reuploadNotionFile(db.icon.file.url);
      }
      if (dbIcon) createPayload.icon = dbIcon;
      let dbCover = _clonePageCover(db.cover);
      if (!dbCover && db.cover?.type === "file" && db.cover.file?.url) {
        dbCover = await this._reuploadNotionFile(db.cover.file.url);
      }
      if (dbCover) createPayload.cover = dbCover;
      if (db.is_inline) createPayload.is_inline = true;
      const newDb = await this._call(() => this.client.databases.create(createPayload));

      // Query all source entries
      const entries = await this._paginateQuery(dsId);
      const newDsId = await this._resolveDataSourceId(newDb.id);

      // Pass 2: Create rows concurrently, build ID map
      const rowTasks = entries.map((entry) => () => {
        const properties = {};
        for (const [name] of cloneableProps) {
          const prop = entry.properties?.[name];
          if (!prop || SKIP_SCHEMA_TYPES.has(prop.type)) continue;
          if (prop.type === "relation" || prop.type === "files") continue; // relation values need ID remapping (v2), files URLs expire
          const cloned = clonePropertyValue(prop);
          if (cloned) properties[name] = cloned;
        }
        return this.client.pages.create({ parent: { data_source_id: newDsId }, properties });
      });

      const rowResults = await this._callBatch(rowTasks, 5);
      const rowIdMap = new Map();
      let created = 0;
      const errors = [];
      for (let i = 0; i < rowResults.length; i++) {
        if (rowResults[i].ok) {
          rowIdMap.set(entries[i].id, rowResults[i].value.id);
          created++;
        } else {
          errors.push({ error: String(rowResults[i].error) });
        }
      }

      // Pass 3: Copy row page bodies
      for (const [oldId, newId] of rowIdMap) {
        try {
          await this._deepCopyBlocks(oldId, newId);
        } catch (e) {
          errors.push({ error: `Row body copy failed: ${e}` });
        }
      }

      return { success: true, databaseId: newDb.id, url: newDb.url, entriesCloned: created, rowIdMap, errors };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Add database entry with auto-detected property types */
  async addDatabaseEntry(dbId, values) {
    try {
      const nid = normalizeId(dbId);
      const dsId = await this._resolveDataSourceId(nid);
      const ds = await this._call(() => this.client.dataSources.retrieve({ data_source_id: dsId }));
      const properties = {};
      for (const [name, value] of Object.entries(values)) {
        const propSchema = ds.properties?.[name];
        if (!propSchema) continue;
        properties[name] = buildPropertyValue(propSchema.type, value);
      }
      const page = await this._call(() =>
        this.client.pages.create({
          parent: { data_source_id: dsId },
          properties,
        }),
      );
      return { success: true, pageId: page.id, url: page.url };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Create a Notion database from a markdown table with inferred column types.
   *  Resolves data source once and inserts rows directly (no per-row schema fetch). */
  async importTable(parentId, content, { title } = {}) {
    const parsed = parseMarkdownTableData(content);
    if (!parsed) return { success: false, error: "No valid markdown table found in content" };

    const types = inferColumnTypes(parsed.headers, parsed.rows);

    // Build schema from inferred types
    const schema = {};
    for (const header of parsed.headers) {
      const type = types[header];
      if (type === "title") {
        schema[header] = { title: {} };
      } else if (type === "select") {
        const colIdx = parsed.headers.indexOf(header);
        const unique = [...new Set(parsed.rows.map((r) => r[colIdx]).filter(Boolean))];
        schema[header] = { select: { options: unique.map((v) => ({ name: v })) } };
      } else {
        schema[header] = { [type]: {} };
      }
    }

    // Create database
    const dbResult = await this.createDatabase(normalizeId(parentId), title || "Imported Table", schema);
    if (!dbResult.success) return dbResult;

    // Resolve data source once
    const dsId = await this._resolveDataSourceId(dbResult.databaseId);

    // Insert rows concurrently via _callBatch
    const tasks = parsed.rows.map((row) => () => {
      const properties = {};
      parsed.headers.forEach((h, idx) => {
        if (!row[idx]) return;
        const t = types[h];
        let val = row[idx];
        if (t === "number") val = Number(val);
        else if (t === "checkbox") val = /^(true|yes)$/i.test(val);
        properties[h] = buildPropertyValue(t, val);
      });
      return this.client.pages.create({ parent: { data_source_id: dsId }, properties });
    });

    const results = await this._callBatch(tasks, 5);
    let created = 0;
    const errors = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].ok) {
        created++;
      } else {
        errors.push({
          row: Object.fromEntries(parsed.headers.map((h, idx) => [h, parsed.rows[i][idx]])),
          error: String(results[i].error),
        });
      }
    }

    return { success: true, databaseId: dbResult.databaseId, url: dbResult.url, entriesCreated: created, errors };
  }

  // ── STRUCTURAL Actions ──────────────────────────────────────────────────

  /** Move blocks from source to target page with rollback on failure */
  async moveBlocks(sourcePageId, targetPageId, blockIds, { position } = {}) {
    const srcId = normalizeId(sourcePageId);
    const tgtId = normalizeId(targetPageId);
    await this.snapshot(srcId);
    const created = [];
    try {
      let pos = position || { type: "end" };
      for (const blockId of blockIds) {
        const bid = normalizeId(blockId);
        const block = await this._call(() => this.client.blocks.retrieve({ block_id: bid }));
        let children = [];
        if (block.has_children) children = await this._fetchBlocksRecursive(bid);
        const newBlock = recreateBlock(block, children);
        if (!newBlock) continue;
        const resp = await this._call(() =>
          this.client.blocks.children.append({ block_id: tgtId, children: [newBlock], position: pos }),
        );
        const newId = resp.results?.[0]?.id;
        if (newId) {
          created.push(newId);
          pos = { type: "after_block", after_block: { id: newId } };
        }
        await this._call(() => this.client.blocks.delete({ block_id: bid }));
      }
      return { success: true, moved: created.length, newBlockIds: created };
    } catch (e) {
      for (const id of created) await this._call(() => this.client.blocks.delete({ block_id: id })).catch(() => {});
      return { success: false, error: String(e), rolledBack: true };
    }
  }

  /** Move page to new parent via deep copy + archive (API parent is read-only) */
  async movePage(pageId, newParentId, { parentType: _parentType = "page" } = {}) {
    const nid = normalizeId(pageId);
    try {
      await this.snapshot(nid);
      const result = await this.deepCopy(nid, normalizeId(newParentId));
      if (!result.success) return result;
      await this._call(() => this.client.pages.update({ page_id: nid, archived: true }));
      return { success: true, newPageId: result.newPageId, originalArchived: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Reorder blocks: snapshot, fetch all, delete all, recreate in new order */
  async reorderBlocks(pageId, newOrder) {
    const nid = normalizeId(pageId);
    try {
      await this.snapshot(nid);
      const blocks = await this._fetchBlocksRecursive(nid);
      const blockMap = new Map();
      for (const b of blocks) blockMap.set(b.id, b);

      // Build full order: specified IDs first, then remaining in original order
      const ordered = [];
      const used = new Set();
      for (const id of newOrder) {
        const noid = normalizeId(id);
        if (blockMap.has(noid)) {
          ordered.push(blockMap.get(noid));
          used.add(noid);
        }
      }
      for (const b of blocks) {
        if (!used.has(b.id)) ordered.push(b);
      }

      // Delete all existing blocks
      const shallow = await this._fetchBlocksShallow(nid);
      for (const block of shallow) {
        if (block.type === "child_page" || block.type === "child_database") continue;
        await this._call(() => this.client.blocks.delete({ block_id: block.id })).catch(() => {});
      }

      // Recreate in order
      const recreated = ordered.map((b) => recreateBlock(b, b.children || [])).filter(Boolean);
      await this._appendWithDeepChildren(nid, recreated);
      return { success: true, reordered: newOrder.length };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Deep copy page (shell + blocks + subpages + child databases) recursively. */
  async deepCopy(sourcePageId, targetParentId) {
    const srcId = normalizeId(sourcePageId);
    const tgtId = normalizeId(targetParentId);
    try {
      const page = await this._call(() => this.client.pages.retrieve({ page_id: srcId }));

      // Extract rich text title (preserves formatting, mentions, links)
      let titleRt = [{ text: { content: "Untitled" } }];
      for (const prop of Object.values(page.properties || {})) {
        if (prop.type === "title" && prop.title?.length) {
          titleRt = _cloneRichTextArray(prop.title);
          break;
        }
      }

      // Build creation payload with shell metadata
      const createPayload = {
        parent: { page_id: tgtId },
        properties: { title: titleRt },
      };
      let icon = _clonePageIcon(page.icon);
      if (!icon && page.icon?.type === "file" && page.icon.file?.url) {
        icon = await this._reuploadNotionFile(page.icon.file.url);
      }
      let cover = _clonePageCover(page.cover);
      if (!cover && page.cover?.type === "file" && page.cover.file?.url) {
        cover = await this._reuploadNotionFile(page.cover.file.url);
      }
      if (icon) createPayload.icon = icon;
      if (cover) createPayload.cover = cover;

      const newPage = await this._call(() => this.client.pages.create(createPayload));

      // Copy is_locked (update-only field, not available on create)
      if (page.is_locked) {
        await this._call(() => this.client.pages.update({ page_id: newPage.id, is_locked: true })).catch(() => {});
      }

      // Copy blocks with rollback on root failure
      try {
        const warnings = await this._deepCopyBlocks(srcId, newPage.id);

        if (page.icon && !icon)
          warnings.push({ type: "icon_skipped", reason: "Notion-hosted file icon requires re-upload" });
        if (page.cover && !cover)
          warnings.push({ type: "cover_skipped", reason: "Notion-hosted file cover requires re-upload" });

        const result = { success: true, newPageId: newPage.id };
        if (warnings.length > 0) result.warnings = warnings;
        return result;
      } catch (contentError) {
        try {
          await this._call(() => this.client.pages.update({ page_id: newPage.id, archived: true }));
        } catch {
          /* best effort */
        }
        return { success: false, error: `Content copy failed (page archived): ${contentError}` };
      }
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Recursively copy blocks from source to target. Returns warnings array. */
  async _deepCopyBlocks(sourceId, targetId) {
    const MEDIA_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);
    const INLINE_CHILDREN_TYPES = new Set(["table", "column_list"]);
    const blocks = await this._fetchBlocksShallow(sourceId);
    const tgtId = normalizeId(targetId);
    const warnings = [];
    let batch = [];
    let batchSources = [];

    const flushBatch = async () => {
      if (batch.length === 0) return;
      try {
        const resp = await this._call(() => this.client.blocks.children.append({ block_id: tgtId, children: batch }));
        for (let i = 0; i < batchSources.length; i++) {
          if (batchSources[i].has_children && resp.results[i]?.id) {
            const childWarnings = await this._deepCopyBlocks(batchSources[i].id, resp.results[i].id);
            warnings.push(...childWarnings);
          }
        }
      } catch (e) {
        warnings.push({ type: "batch_append_failed", blockCount: batch.length, error: String(e) });
      }
      batch = [];
      batchSources = [];
    };

    for (const block of blocks) {
      if (block.type === "child_page") {
        await flushBatch();
        const result = await this.deepCopy(block.id, tgtId);
        if (!result.success) {
          warnings.push({ type: "child_page", sourceId: block.id, error: result.error });
        } else if (result.warnings) {
          warnings.push(...result.warnings);
        }
      } else if (block.type === "child_database") {
        await flushBatch();
        const result = await this._cloneDatabase(block.id, tgtId);
        if (!result.success) {
          warnings.push({ type: "child_database", sourceId: block.id, error: result.error });
        } else if (result.errors?.length) {
          for (const e of result.errors) {
            warnings.push({ type: "child_database_row", databaseId: result.databaseId, ...e });
          }
        }
      } else {
        // Table and column_list require children inline at creation time
        let cloned;
        let blockForRecursion = block;
        if (INLINE_CHILDREN_TYPES.has(block.type) && block.has_children) {
          const inlineChildren = await this._fetchBlocksShallow(block.id);
          const clonedChildren = [];
          for (const c of inlineChildren) {
            // column blocks also require their content children inline
            if (c.type === "column" && c.has_children) {
              const colContent = await this._fetchBlocksShallow(c.id);
              const clonedColContent = [];
              for (const cc of colContent) {
                // Handle tables inside columns (need inline table_row children)
                if (cc.type === "table" && cc.has_children) {
                  const tableRows = await this._fetchBlocksShallow(cc.id);
                  const clonedRows = tableRows
                    .map((r) => _sanitizeBlockForCreate(recreateBlock(r, [])))
                    .filter(Boolean);
                  const tb = _sanitizeBlockForCreate(recreateBlock(cc, clonedRows));
                  if (tb) clonedColContent.push(tb);
                  // Handle Notion-hosted images inside columns (need re-upload)
                } else if (MEDIA_TYPES.has(cc.type) && cc[cc.type]?.type === "file" && cc[cc.type]?.file?.url) {
                  const uploaded = await this._reuploadNotionFile(cc[cc.type].file.url);
                  if (uploaded) {
                    const mediaBlock = _sanitizeBlockForCreate(recreateBlock(cc, []));
                    if (mediaBlock) {
                      mediaBlock[cc.type] = { type: "file_upload", file_upload: { id: uploaded.file_upload.id } };
                      if (cc[cc.type].caption?.length) mediaBlock[cc.type].caption = cc[cc.type].caption;
                      clonedColContent.push(mediaBlock);
                    }
                  } else {
                    warnings.push({ type: "media_upload_failed", blockType: cc.type, sourceId: cc.id });
                  }
                  // Skip external media with invalid URLs inside columns
                } else if (
                  MEDIA_TYPES.has(cc.type) &&
                  cc[cc.type]?.type === "external" &&
                  !(cc[cc.type]?.external?.url || "").startsWith("http")
                ) {
                  warnings.push({ type: "invalid_media_url_skipped", blockType: cc.type, sourceId: cc.id });
                } else {
                  const cb = _sanitizeBlockForCreate(recreateBlock(cc, []));
                  if (cb) clonedColContent.push(cb);
                }
              }
              const colBlock = _sanitizeBlockForCreate(recreateBlock(c, clonedColContent));
              if (colBlock) clonedChildren.push(colBlock);
            } else {
              const cc = _sanitizeBlockForCreate(recreateBlock(c, []));
              if (cc) clonedChildren.push(cc);
            }
          }
          cloned = _sanitizeBlockForCreate(recreateBlock(block, clonedChildren));
          blockForRecursion = { ...block, has_children: false };
        } else {
          cloned = _sanitizeBlockForCreate(recreateBlock(block, []));
        }
        if (!cloned) continue;
        // Skip external media with invalid URLs (data: URIs, relative paths — API rejects them)
        if (MEDIA_TYPES.has(block.type) && cloned[block.type]?.type === "external") {
          const extUrl = cloned[block.type].external?.url || "";
          if (!extUrl.startsWith("https://") && !extUrl.startsWith("http://")) {
            warnings.push({
              type: "invalid_media_url_skipped",
              blockType: block.type,
              sourceId: block.id,
              url: extUrl.substring(0, 80),
            });
            continue;
          }
        }
        // Re-upload Notion-hosted media files via file upload API
        // Flush batch first and append media individually so a failure only loses one block
        if (MEDIA_TYPES.has(block.type) && block[block.type]?.type === "file" && block[block.type]?.file?.url) {
          await flushBatch();
          const uploaded = await this._reuploadNotionFile(block[block.type].file.url);
          if (!uploaded) {
            warnings.push({ type: "media_upload_failed", blockType: block.type, sourceId: block.id });
            continue;
          }
          cloned[block.type] = { type: "file_upload", file_upload: { id: uploaded.file_upload.id } };
          const origContent = block[block.type];
          if (origContent.caption?.length) cloned[block.type].caption = origContent.caption;
          // Append individually — if Notion rejects this block, only it is lost
          try {
            await this._call(() => this.client.blocks.children.append({ block_id: tgtId, children: [cloned] }));
          } catch (e) {
            warnings.push({ type: "media_append_failed", blockType: block.type, sourceId: block.id, error: String(e) });
          }
          continue;
        }
        batch.push(cloned);
        batchSources.push(blockForRecursion);
        if (batch.length >= 100) await flushBatch();
      }
    }
    await flushBatch();
    return warnings;
  }

  /** Copy a page with optional modifications — read source + create modified copy in one call. */
  async copyPageWith(sourcePageId, targetParentId, title, { appendMd, prependMd, replaceTitle } = {}) {
    const srcId = normalizeId(sourcePageId);
    const tgtId = normalizeId(targetParentId);
    try {
      const md = await this.getPage(srcId);
      // Strip the H1 title line from content
      const firstNewlines = md.indexOf("\n\n");
      let contentMd = firstNewlines >= 0 ? md.slice(firstNewlines + 2) : md;

      if (prependMd) contentMd = `${prependMd}\n\n${contentMd}`;
      if (appendMd) contentMd = `${contentMd}\n\n${appendMd}`;

      const finalTitle = replaceTitle || title;
      const result = await this.createPage(tgtId, finalTitle, contentMd);
      return result;
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Merge source pages into target, demoting H1→H2. Optionally archive sources. */
  async mergePages(sourcePageIds, targetPageId, { archiveSources = false } = {}) {
    const tgtId = normalizeId(targetPageId);
    try {
      await this.snapshot(tgtId);
      let merged = 0;
      for (const srcId of sourcePageIds) {
        const md = await this.getPage(normalizeId(srcId));
        const sectionMd = md.startsWith("# ") ? `##${md.slice(1)}` : md;
        await this.appendBlocks(tgtId, sectionMd);
        merged++;
        if (archiveSources) {
          await this._call(() => this.client.pages.update({ page_id: normalizeId(srcId), archived: true }));
        }
      }
      return { success: true, merged, total: sourcePageIds.length };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Split page at heading boundaries into new pages */
  async splitPage(pageId, { headingLevel = 2, createUnderSamePage = false } = {}) {
    const nid = normalizeId(pageId);
    try {
      const md = await this.getPage(nid);
      const page = await this._call(() => this.client.pages.retrieve({ page_id: nid }));
      const parentId = createUnderSamePage ? nid : page.parent?.page_id || nid;

      const headingPrefix = `${"#".repeat(headingLevel)} `;
      const regex = new RegExp(`\n(?=${headingPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`);
      const sections = md.split(regex);

      const created = [];
      for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;
        const titleMatch = trimmed.match(/^#{1,3}\s+(.*)/);
        const title = titleMatch ? titleMatch[1] : "Untitled Section";
        const content = titleMatch ? trimmed.replace(/^#{1,3}\s+.*\n?/, "") : trimmed;
        const result = await this.createPage(parentId, title, content.trim());
        if (result.success) created.push(result.pageId);
      }
      return { success: true, pagesCreated: created.length, pageIds: created };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Extract section from heading to next heading of same/higher level */
  async extractSection(pageId, headingText) {
    const nid = normalizeId(pageId);
    try {
      const blocks = await this._fetchBlocksShallow(nid);
      const sectionBlocks = [];
      let capturing = false;
      let captureLevel = 0;

      for (const block of blocks) {
        const type = block.type;
        if (type?.startsWith("heading_")) {
          const level = parseInt(type.split("_")[1], 10);
          const text = richTextToMd(block[type]?.rich_text);
          if (!capturing && text.toLowerCase().includes(headingText.toLowerCase())) {
            capturing = true;
            captureLevel = level;
            sectionBlocks.push(block);
            continue;
          } else if (capturing && level <= captureLevel) {
            break;
          }
        }
        if (capturing) {
          if (block.has_children && block.type !== "child_page" && block.type !== "child_database") {
            block.children = await this._fetchBlocksRecursive(block.id);
          }
          sectionBlocks.push(block);
        }
      }

      if (!sectionBlocks.length) return { success: false, error: `Section "${headingText}" not found` };
      return { success: true, markdown: blocksToMarkdown(sectionBlocks), blockIds: sectionBlocks.map((b) => b.id) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Replace section content (preserving heading) with new markdown */
  async replaceSection(pageId, headingText, newContentMd) {
    const nid = normalizeId(pageId);
    try {
      await this.snapshot(nid);
      const blocks = await this._fetchBlocksShallow(nid);
      let headingBlockId = null;
      let headingLevel = 0;
      const blocksToDelete = [];
      let pastHeading = false;

      for (const block of blocks) {
        const type = block.type;
        if (type?.startsWith("heading_")) {
          const level = parseInt(type.split("_")[1], 10);
          const text = richTextToMd(block[type]?.rich_text);
          if (!pastHeading && text.toLowerCase().includes(headingText.toLowerCase())) {
            headingBlockId = block.id;
            headingLevel = level;
            pastHeading = true;
            continue;
          } else if (pastHeading && level <= headingLevel) {
            break;
          }
        }
        if (pastHeading) blocksToDelete.push(block.id);
      }

      if (!headingBlockId) return { success: false, error: `Section "${headingText}" not found` };

      for (const id of blocksToDelete) {
        await this._call(() => this.client.blocks.delete({ block_id: id })).catch(() => {});
      }

      return this.insertBlocks(nid, newContentMd, { after: headingBlockId });
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Flatten page: inline subpage content, archive subpages, delete child_page blocks */
  async flattenPage(pageId) {
    const nid = normalizeId(pageId);
    try {
      await this.snapshot(nid);
      const blocks = await this._fetchBlocksShallow(nid);
      let flattened = 0;
      for (const block of blocks) {
        if (block.type === "child_page") {
          const subMd = await this.getPage(block.id);
          const sectionMd = subMd.replace(/^# (.*)/, "## $1");
          await this.insertBlocks(nid, sectionMd, { after: block.id });
          await this._call(() => this.client.pages.update({ page_id: block.id, archived: true }));
          await this._call(() => this.client.blocks.delete({ block_id: block.id })).catch(() => {});
          flattened++;
        }
      }
      return { success: true, flattenedSubpages: flattened };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Nest sections under headings as subpages, delete original section content */
  async nestUnderHeadings(pageId, { headingLevel = 2 } = {}) {
    const nid = normalizeId(pageId);
    try {
      await this.snapshot(nid);
      const result = await this.splitPage(nid, { headingLevel, createUnderSamePage: true });
      if (!result.success) return result;

      // Delete original section content (keep child_page blocks)
      const blocks = await this._fetchBlocksShallow(nid);
      let hitFirstHeading = false;
      for (const block of blocks) {
        if (block.type === "child_page") continue;
        if (block.type?.startsWith("heading_")) hitFirstHeading = true;
        if (hitFirstHeading) {
          await this._call(() => this.client.blocks.delete({ block_id: block.id })).catch(() => {});
        }
      }
      return { success: true, pagesCreated: result.pagesCreated, pageIds: result.pageIds };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Copy page hierarchy without content (skeleton) */
  async duplicateStructure(sourcePageId, targetParentId) {
    const srcId = normalizeId(sourcePageId);
    const tgtId = normalizeId(targetParentId);
    try {
      const tree = await this.getTree(srcId, { depth: 10 });
      const copyTree = async (node, parentId) => {
        const result = await this.createPage(parentId, node.title);
        if (!result.success) return;
        for (const child of node.children || []) {
          if (child.type === "page") await copyTree(child, result.pageId);
        }
      };
      await copyTree(tree, tgtId);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Apply template: copy page, replace {{key}} placeholders */
  async applyTemplate(templatePageId, targetParentId, variables = {}) {
    const srcId = normalizeId(templatePageId);
    const tgtId = normalizeId(targetParentId);
    try {
      let md = await this.getPage(srcId);
      const page = await this._call(() => this.client.pages.retrieve({ page_id: srcId }));
      let title = extractTitle(page);
      for (const [key, value] of Object.entries(variables)) {
        const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
        md = md.replace(pattern, value);
        title = title.replace(pattern, value);
      }
      const firstNewlines = md.indexOf("\n\n");
      const contentMd = firstNewlines >= 0 ? md.slice(firstNewlines + 2) : md;
      return this.createPage(tgtId, title, contentMd);
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  // ── BATCH Actions ───────────────────────────────────────────────────────

  /** Set properties on multiple pages, continuing on individual failures */
  async batchSetProperties(pageIds, props) {
    let updated = 0;
    const errors = [];
    for (const id of pageIds) {
      try {
        await this.setProperties(normalizeId(id), props);
        updated++;
      } catch (e) {
        errors.push({ id, error: String(e) });
      }
    }
    return { success: true, updated, total: pageIds.length, errors };
  }

  /** Archive multiple pages */
  async batchArchive(pageIds) {
    const tasks = pageIds.map((id) => () => this.client.pages.update({ page_id: normalizeId(id), archived: true }));
    const results = await this._callBatch(tasks, 5);
    let archived = 0;
    const errors = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].ok) {
        archived++;
      } else {
        errors.push({ id: pageIds[i], error: String(results[i].error) });
      }
    }
    return { success: true, archived, errors };
  }

  /** Tag multiple pages with a select property value */
  async batchTag(pageIds, property, value) {
    return this.batchSetProperties(pageIds, { [property]: { select: { name: value } } });
  }

  // ── SAFETY Actions ──────────────────────────────────────────────────────

  /** In-memory snapshot of page block tree. Max 20, evicts oldest. */
  async snapshot(pageId) {
    const nid = normalizeId(pageId);
    try {
      const snapId = `${nid}_${Date.now()}`;
      const blocks = await this._fetchBlocksRecursive(nid);
      this._snapshots.set(snapId, { pageId: nid, blocks, timestamp: new Date().toISOString() });
      // Evict oldest if over 20
      while (this._snapshots.size > 20) {
        const oldest = this._snapshots.keys().next().value;
        this._snapshots.delete(oldest);
      }
      return { success: true, snapshotId: snapId };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Restore page from snapshot. Calls updatePage with _skipSnapshot to avoid loop. */
  async restore(snapId) {
    try {
      const snap = this._snapshots.get(snapId);
      if (!snap) return { success: false, error: "Snapshot not found" };
      const md = blocksToMarkdown(snap.blocks);
      await this.updatePage(snap.pageId, md, { _skipSnapshot: true });
      return { success: true, pageId: snap.pageId, restoredFrom: snap.timestamp };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Recursively backup page + subpages as markdown files */
  async backupPage(pageId, dirPath) {
    const nid = normalizeId(pageId);
    try {
      await mkdir(dirPath, { recursive: true });
      const page = await this._call(() => this.client.pages.retrieve({ page_id: nid }));
      const title = extractTitle(page);
      const safe = safeName(title) || "page";
      const md = await this.getPage(nid);
      const filePath = join(dirPath, `${safe}.md`);
      await writeFile(filePath, md, "utf-8");
      const files = [filePath];

      const blocks = await this._fetchBlocksShallow(nid);
      for (const block of blocks) {
        if (block.type === "child_page") {
          const sub = await this.backupPage(block.id, join(dirPath, safe));
          if (sub.success) files.push(...sub.files);
        }
      }
      return { success: true, files, count: files.length };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Backup database: schema.json, entries.json, entries.csv */
  async backupDatabase(dbId, dirPath) {
    const nid = normalizeId(dbId);
    try {
      await mkdir(dirPath, { recursive: true });
      const data = await this.getDatabase(nid);

      const schemaPath = join(dirPath, "schema.json");
      await writeFile(schemaPath, JSON.stringify(data.schema, null, 2), "utf-8");

      const rows = data.entries.map((entry) => {
        const row = { _id: entry.id };
        for (const [name, prop] of Object.entries(entry.properties || {})) row[name] = extractPropertyValue(prop);
        return row;
      });

      const jsonPath = join(dirPath, "entries.json");
      await writeFile(jsonPath, JSON.stringify(rows, null, 2), "utf-8");

      const csvPath = join(dirPath, "entries.csv");
      if (rows.length > 0) {
        const headers = Object.keys(rows[0]);
        const csvLines = [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))];
        await writeFile(csvPath, csvLines.join("\n"), "utf-8");
      } else {
        await writeFile(csvPath, "", "utf-8");
      }
      return { success: true, schema: schemaPath, json: jsonPath, csv: csvPath };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /** Execute operations as transaction. Snapshot all, rollback on failure. */
  async transact(operations) {
    const snapIds = [];
    try {
      // Snapshot all affected pages
      const pageIds = new Set();
      for (const op of operations) {
        if (op.pageId) pageIds.add(normalizeId(op.pageId));
      }
      for (const pid of pageIds) {
        const snap = await this.snapshot(pid);
        if (snap.success) snapIds.push(snap.snapshotId);
      }

      // Execute sequentially
      const results = [];
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const method = this[op.action];
        if (!method) throw new Error(`Unknown action: ${op.action}`);
        const result = await method.call(this, ...(op.args || []));
        results.push(result);
        if (result?.success === false) throw new Error(result.error || `Operation ${i} failed`);
      }
      return { success: true, results };
    } catch (e) {
      // Rollback all snapshots
      for (const sid of snapIds) await this.restore(sid).catch(() => {});
      return { success: false, rolledBack: true, failedAt: e.message, error: String(e) };
    }
  }

  // ── ANALYSIS Actions ────────────────────────────────────────────────────

  /** Map entire workspace: all pages and databases */
  async workspaceMap() {
    const pages = await this.search("", { type: "page" });
    const databases = await this.search("", { type: "data_source" });
    return { pages, databases, totalPages: pages.length, totalDatabases: databases.length };
  }

  /** Page statistics: block count, depth, word count */
  async pageStats(pageId) {
    const nid = normalizeId(pageId);
    const page = await this._call(() => this.client.pages.retrieve({ page_id: nid }));
    const blocks = await this._fetchBlocksRecursive(nid);
    const md = blocksToMarkdown(blocks);
    const { count, maxDepth } = this._countBlocks(blocks);
    return {
      pageId: nid,
      title: extractTitle(page),
      blockCount: count,
      maxDepth,
      wordCount: md.split(/\s+/).filter(Boolean).length,
      lastEdited: page.last_edited_time,
      created: page.created_time,
    };
  }

  /** Line-level diff between two pages */
  async diffPages(pageId1, pageId2) {
    const [md1, md2] = await Promise.all([this.getPage(normalizeId(pageId1)), this.getPage(normalizeId(pageId2))]);
    const lines1 = md1.split("\n").filter((l) => l.trim());
    const lines2 = md2.split("\n").filter((l) => l.trim());
    const set1 = new Set(lines1);
    const set2 = new Set(lines2);
    const common = lines1.filter((l) => set2.has(l));
    return {
      onlyInFirst: lines1.filter((l) => !set2.has(l)),
      onlyInSecond: lines2.filter((l) => !set1.has(l)),
      common,
      stats: { page1Lines: lines1.length, page2Lines: lines2.length, commonLines: common.length },
    };
  }

  /** Find pages with duplicate lowercase-trimmed titles */
  async findDuplicates() {
    const { pages } = await this.workspaceMap();
    const groups = {};
    for (const p of pages) {
      const key = p.title.toLowerCase().trim();
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return Object.entries(groups)
      .filter(([, pages]) => pages.length > 1)
      .map(([title, pages]) => ({ title, count: pages.length, pages }));
  }

  /** Find pages at workspace root (parent.type === "workspace") */
  async findOrphans() {
    const { pages } = await this.workspaceMap();
    return pages.filter((p) => p.parent?.type === "workspace");
  }

  /** Find pages with zero content blocks (max 100 checked) */
  async findEmpty() {
    const { pages } = await this.workspaceMap();
    const empty = [];
    for (const p of pages.slice(0, 100)) {
      try {
        const blocks = await this._fetchBlocksShallow(p.id);
        if (blocks.length === 0) empty.push(p);
      } catch {
        /* skip inaccessible */
      }
    }
    return empty;
  }

  /** Find pages not edited within N days (default 30) */
  async findStale(days = 30) {
    const { pages } = await this.workspaceMap();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return pages.filter((p) => p.lastEdited && p.lastEdited < cutoff);
  }

  /** Analyze page tree and suggest reorganization */
  async suggestReorganization(pageId) {
    const nid = normalizeId(pageId);
    const tree = await this.getTree(nid, { depth: 5 });
    const stats = await this.pageStats(nid);
    const suggestions = [];

    const checkDepth = (node, depth = 0) => {
      if (depth > 3)
        suggestions.push({
          type: "too_deep",
          message: `"${node.title}" is nested ${depth} levels deep`,
          pageId: node.id,
        });
      for (const child of node.children || []) checkDepth(child, depth + 1);
    };
    checkDepth(tree);

    const checkWidth = (node) => {
      if ((node.children?.length || 0) > 10)
        suggestions.push({
          type: "too_wide",
          message: `"${node.title}" has ${node.children.length} children`,
          pageId: node.id,
        });
      for (const child of node.children || []) checkWidth(child);
    };
    checkWidth(tree);

    if (stats.wordCount > 3000)
      suggestions.push({ type: "too_long", message: `Page has ${stats.wordCount} words`, pageId: nid });
    if (stats.blockCount > 200)
      suggestions.push({ type: "many_blocks", message: `Page has ${stats.blockCount} blocks`, pageId: nid });

    return { tree, stats, suggestions, suggestionCount: suggestions.length };
  }

  // ── Internal Helpers ────────────────────────────────────────────────────

  _countBlocks(blocks, depth = 0) {
    let count = blocks.length;
    let maxDepth = depth;
    for (const b of blocks) {
      if (b.children?.length) {
        const sub = this._countBlocks(b.children, depth + 1);
        count += sub.count;
        maxDepth = Math.max(maxDepth, sub.maxDepth);
      }
    }
    return { count, maxDepth };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLI Dispatcher
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Explicit action registry — no signature introspection */
const ACTIONS = {
  // READ
  search: { args: ["query"], options: ["type"] },
  getPage: { args: ["pageId"], options: ["format"] },
  getDatabase: { args: ["dbId"], options: [] },
  queryDatabase: { args: ["dbId"], options: ["filter", "sorts", "limit", "format"] },
  getTree: { args: ["pageId"], options: ["depth"] },
  exportPage: { args: ["pageId", "path"], options: [] },
  exportDatabase: { args: ["dbId", "path"], options: ["format"] },
  getComments: { args: ["pageId"], options: [] },
  getUsers: { args: [], options: [] },
  // WRITE
  createPage: { args: ["parentId", "title", "content"], options: ["parentType"] },
  updatePage: { args: ["pageId", "content"], options: [] },
  appendBlocks: { args: ["pageId", "content"], options: [] },
  insertBlocks: { args: ["pageId", "content"], options: ["after", "atHeading", "atStart"] },
  setProperties: { args: ["pageId", "props"], options: [] },
  addComment: { args: ["pageId", "text"], options: [] },
  lockPage: { args: ["pageId"], options: [] },
  unlockPage: { args: ["pageId"], options: [] },
  createDatabase: { args: ["parentId", "title", "schema"], options: [] },
  addDatabaseEntry: { args: ["dbId", "values"], options: [] },
  importTable: { args: ["parentId", "content"], options: ["title"] },
  // STRUCTURAL
  moveBlocks: { args: ["sourcePageId", "targetPageId", "blockIds"], options: ["position"] },
  movePage: { args: ["pageId", "newParentId"], options: ["parentType"] },
  reorderBlocks: { args: ["pageId", "newOrder"], options: [] },
  deepCopy: { args: ["sourcePageId", "targetParentId"], options: [] },
  copyPageWith: {
    args: ["sourcePageId", "targetParentId", "title"],
    options: ["appendMd", "prependMd", "replaceTitle"],
  },
  mergePages: { args: ["sourcePageIds", "targetPageId"], options: ["archiveSources"] },
  splitPage: { args: ["pageId"], options: ["headingLevel", "createUnderSamePage"] },
  extractSection: { args: ["pageId", "headingText"], options: [] },
  replaceSection: { args: ["pageId", "headingText", "content"], options: [] },
  flattenPage: { args: ["pageId"], options: [] },
  nestUnderHeadings: { args: ["pageId"], options: ["headingLevel"] },
  duplicateStructure: { args: ["sourcePageId", "targetParentId"], options: [] },
  applyTemplate: { args: ["templatePageId", "targetParentId", "variables"], options: [] },
  // BATCH
  batchSetProperties: { args: ["pageIds", "props"], options: [] },
  batchArchive: { args: ["pageIds"], options: [] },
  batchTag: { args: ["pageIds", "property", "value"], options: [] },
  // SAFETY
  snapshot: { args: ["pageId"], options: [] },
  restore: { args: ["snapId"], options: [] },
  backupPage: { args: ["pageId", "dirPath"], options: [] },
  backupDatabase: { args: ["dbId", "dirPath"], options: [] },
  transact: { args: ["operations"], options: [] },
  // ANALYSIS
  workspaceMap: { args: [], options: [] },
  pageStats: { args: ["pageId"], options: [] },
  diffPages: { args: ["pageId1", "pageId2"], options: [] },
  findDuplicates: { args: [], options: [] },
  findOrphans: { args: [], options: [] },
  findEmpty: { args: [], options: [] },
  findStale: { args: ["days"], options: [] },
  suggestReorganization: { args: ["pageId"], options: [] },
};

/** Convert snake_case to camelCase */
function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Common action aliases — maps wrong names to correct ones */
const ACTION_ALIASES = {
  readPage: "getPage",
  fetchPage: "getPage",
  read: "getPage",
  get: "getPage",
  updateProperties: "setProperties",
  updateProps: "setProperties",
  query: "queryDatabase",
  queryDb: "queryDatabase",
  copy: "deepCopy",
  copyPage: "deepCopy",
  merge: "mergePages",
  split: "splitPage",
  archive: "batchArchive",
  duplicate: "deepCopy",
  tableToDatabase: "importTable",
  createDatabaseFromTable: "importTable",
};

/** Resolve action name with alias fallback */
function resolveAction(name) {
  const camel = toCamelCase(name);
  return ACTION_ALIASES[camel] || camel;
}

/** Parse CLI args, extracting --flag values into an options object.
 *  Returns { positional: string[], flags: Record<string, string> } */
// Map short/natural flag names to the actual arg/option names used by actions
const FLAG_ALIASES = {
  source: "sourcePageId",
  src: "sourcePageId",
  parent: "targetParentId",
  target: "targetParentId",
  dest: "targetParentId",
  page: "pageId",
  id: "pageId",
  db: "dbId",
  database: "dbId",
  append: "appendMd",
  prepend: "prependMd",
  content: "content",
  md: "content",
  title: "title",
  name: "title",
  query: "query",
  q: "query",
  filter: "filter",
  sort: "sorts",
  sorts: "sorts",
  depth: "depth",
  after: "after",
};

function parseCliArgs(rawArgs) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a.startsWith("--")) {
      const raw = toCamelCase(a.slice(2));
      const key = FLAG_ALIASES[raw] || raw;
      const next = rawArgs[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

/** CLI output formatters for simple-args mode */
function formatSearchResults(results) {
  return results.map((r) => `  [${r.type}] ${r.title} (${r.id})`).join("\n");
}

function formatWorkspaceMap(data) {
  const lines = [`📊 Workspace: ${data.totalPages} pages, ${data.totalDatabases} databases`];
  for (const p of data.pages.slice(0, 50)) lines.push(`  📄 ${p.title} (${p.id})`);
  for (const d of data.databases.slice(0, 20)) lines.push(`  🗃️ ${d.title} (${d.id})`);
  return lines.join("\n");
}

function formatDuplicates(groups) {
  return groups.map((g) => `  "${g.title}" — ${g.count} copies`).join("\n");
}

/** Format queryDatabase entries as a compact markdown table with row IDs */
function formatQueryResults(entries) {
  if (!entries || entries.length === 0) return "_No entries found._";

  const allCols = Object.keys(entries[0].properties);
  const capped = allCols.length > 8;
  const cols = allCols.slice(0, 8);

  const cellValue = (entry, col) => {
    const prop = entry.properties[col];
    if (!prop) return "";
    let v = extractPropertyValue(prop);
    if (typeof v !== "string") v = JSON.stringify(v);
    v = v.replace(/\|/g, "\\|").replace(/\n/g, " ");
    if (v.length > 80) v = `${v.slice(0, 79)}…`;
    return v;
  };

  const header = ["ID", ...cols];
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];

  for (const entry of entries) {
    const id = (entry.id || "").replace(/-/g, "").slice(-4);
    const cells = [id, ...cols.map((c) => cellValue(entry, c))];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push("");
  const footer = `_${entries.length} entries_`;
  if (capped) {
    lines.push(`_… and ${allCols.length - 8} more columns. Use --format raw for all._`);
  }
  lines.push(footer);
  return lines.join("\n");
}

function printHelp() {
  const desc = {
    search: "Search workspace pages/databases",
    getPage: "Get page content as markdown",
    getDatabase: "Get database schema + all entries",
    queryDatabase: "Query database (markdown table; --format raw for JSON)",
    getTree: "Hierarchical page/database tree",
    exportPage: "Save page as markdown file",
    exportDatabase: "Export as CSV or JSON",
    getComments: "All comments on a page",
    getUsers: "All workspace users",
    createPage: "Create page from markdown",
    updatePage: "Replace all content (auto-snapshots)",
    appendBlocks: "Append markdown to end of page",
    insertBlocks: "Insert blocks at position",
    setProperties: "Update page/entry properties (auto-typed)",
    addComment: "Add comment to page",
    lockPage: "Lock page",
    unlockPage: "Unlock page",
    createDatabase: "Create database with schema",
    addDatabaseEntry: "Add row with auto-typed properties",
    importTable: "Create database from markdown table (infers types)",
    moveBlocks: "Move blocks between pages with rollback",
    movePage: "Move page (deep copy + archive)",
    reorderBlocks: "Reorder blocks by ID array",
    deepCopy: "Full recursive page copy",
    copyPageWith: "Read + modify + create in one call",
    mergePages: "Combine multiple pages into one",
    splitPage: "Split page at headings into subpages",
    extractSection: "Get one section's markdown",
    replaceSection: "Replace section content (auto-snapshots)",
    flattenPage: "Inline subpages into parent",
    nestUnderHeadings: "Convert sections to subpages",
    duplicateStructure: "Copy hierarchy (empty pages)",
    applyTemplate: "Template with {{placeholders}}",
    batchSetProperties: "Update properties on multiple pages",
    batchArchive: "Archive multiple pages",
    batchTag: "Tag pages with select value",
    snapshot: "In-memory snapshot (max 20)",
    restore: "Restore from snapshot",
    backupPage: "Recursive backup to disk",
    backupDatabase: "Export schema + entries to disk",
    transact: "Multi-op with rollback",
    workspaceMap: "All pages and databases",
    pageStats: "Block count, depth, word count",
    diffPages: "Line-level page comparison",
    findDuplicates: "Pages with same title",
    findOrphans: "Root-level pages",
    findEmpty: "Pages with no content",
    findStale: "Pages not edited in N days",
    suggestReorganization: "Structure improvement suggestions",
  };
  const lines = ["Usage: node actions.mjs <action> [args...]\n"];
  for (const [name, spec] of Object.entries(ACTIONS)) {
    const sig = [...spec.args.map((a) => `<${a}>`), ...spec.options.map((o) => `[--${o}]`)].join(" ");
    lines.push(`  ${name.padEnd(24)} ${sig.padEnd(44)} ${desc[name] || ""}`);
  }
  lines.push("");
  lines.push("queryDatabase returns markdown by default. Use --format raw for JSON.");
  lines.push('Stdin: echo \'{"action":"..."}\' | node actions.mjs -');
  console.log(lines.join("\n"));
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === "--help" || arg === "-h" || arg === "help") {
    printHelp();
    process.exit(arg ? 0 : 1);
  }

  const na = new NotionActions();
  let actionName, methodArgs;

  if (arg === "-") {
    // Stdin JSON mode — read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf-8");
    const req = JSON.parse(raw);
    actionName = resolveAction(req.action);

    if (req.contentFile) {
      req.content = await readFile(req.contentFile, "utf-8");
      delete req.contentFile;
    }
    if (req.markdownFile) {
      req.content = await readFile(req.markdownFile, "utf-8");
      delete req.markdownFile;
    }

    const spec = ACTIONS[actionName];
    if (!spec) {
      console.log(
        JSON.stringify(
          { success: false, error: `Unknown action: ${req.action}. Run with --help to see available actions.` },
          null,
          2,
        ),
      );
      process.exit(1);
    }

    const positional = spec.args.map((name) => req[name]);
    const options = {};
    for (const opt of spec.options) {
      if (req[opt] !== undefined) options[opt] = req[opt];
    }
    methodArgs = Object.keys(options).length > 0 ? [...positional, options] : positional;
  } else if (arg.endsWith(".json")) {
    // JSON request file mode
    const raw = await readFile(arg, "utf-8");
    const req = JSON.parse(raw);
    actionName = resolveAction(req.action);

    // Handle contentFile / markdownFile
    if (req.contentFile) {
      req.content = await readFile(req.contentFile, "utf-8");
      delete req.contentFile;
    }
    if (req.markdownFile) {
      req.content = await readFile(req.markdownFile, "utf-8");
      delete req.markdownFile;
    }

    const spec = ACTIONS[actionName];
    if (!spec) {
      console.log(
        JSON.stringify(
          { success: false, error: `Unknown action: ${req.action}. Run with --help to see available actions.` },
          null,
          2,
        ),
      );
      process.exit(1);
    }

    // Check for unknown fields (strict mode)
    const knownFields = new Set(["action", "contentFile", "markdownFile", ...spec.args, ...spec.options]);
    for (const key of Object.keys(req)) {
      if (!knownFields.has(key)) {
        console.log(JSON.stringify({ success: false, error: `Unknown parameter: ${key}` }, null, 2));
        process.exit(1);
      }
    }

    // Map named params to positional args + options
    const positional = spec.args.map((name) => req[name]);
    const options = {};
    for (const opt of spec.options) {
      if (req[opt] !== undefined) options[opt] = req[opt];
    }
    methodArgs = Object.keys(options).length > 0 ? [...positional, options] : positional;
  } else {
    // Simple positional args mode (with --flag support and aliases)
    actionName = resolveAction(arg);
    const spec = ACTIONS[actionName];
    if (!spec) {
      console.error(`Unknown action: ${arg}. Run with --help to see available actions.`);
      process.exit(1);
    }

    const rawArgs = process.argv.slice(3);
    const { positional, flags } = parseCliArgs(rawArgs);

    // Parse positional args (JSON auto-detection)
    const parsedPositional = positional.map((a) => {
      if (a.startsWith("{") || a.startsWith("[")) {
        try {
          return JSON.parse(a);
        } catch {
          return a;
        }
      }
      return a;
    });

    // Merge --flags into options object for the method
    const options = {};
    for (const opt of spec.options) {
      if (flags[opt] !== undefined) {
        const v = flags[opt];
        if (v.startsWith("{") || v.startsWith("[")) {
          try {
            options[opt] = JSON.parse(v);
          } catch {
            options[opt] = v;
          }
        } else {
          options[opt] = v;
        }
      }
    }

    // Also check if any flags match positional arg names that weren't provided positionally
    for (const [i, argName] of spec.args.entries()) {
      if (parsedPositional[i] === undefined && flags[argName] !== undefined) {
        const v = flags[argName];
        if (v.startsWith("{") || v.startsWith("[")) {
          try {
            parsedPositional[i] = JSON.parse(v);
          } catch {
            parsedPositional[i] = v;
          }
        } else {
          parsedPositional[i] = v;
        }
      }
    }

    methodArgs = Object.keys(options).length > 0 ? [...parsedPositional, options] : parsedPositional;
  }

  const method = na[actionName];
  if (!method) {
    console.error(`Method not found: ${actionName}`);
    process.exit(1);
  }

  // Capture CLI-only format option (e.g. --format raw) before dispatch
  const spec = ACTIONS[actionName];
  const cliFormat = spec?.options.includes("format")
    ? methodArgs.find((a) => a && typeof a === "object" && a.format)?.format
    : undefined;

  try {
    const result = await method.call(na, ...methodArgs);

    if (typeof result === "string") {
      console.log(result);
    } else if (!arg.endsWith(".json")) {
      // Simple-args mode: special formatters
      if (actionName === "queryDatabase" && Array.isArray(result) && cliFormat !== "raw") {
        console.log(formatQueryResults(result));
      } else if (actionName === "search") {
        console.log(formatSearchResults(result));
      } else if (actionName === "workspaceMap") {
        console.log(formatWorkspaceMap(result));
      } else if (actionName === "findDuplicates") {
        console.log(formatDuplicates(result));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    } else {
      // JSON file mode: still format queryDatabase as markdown unless raw
      if (actionName === "queryDatabase" && Array.isArray(result) && cliFormat !== "raw") {
        console.log(formatQueryResults(result));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    }

    if (result?.success === false) process.exit(1);
  } catch (e) {
    console.error(e.message || String(e));
    process.exit(1);
  }
}

// CLI execution guard
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// Named exports for testing and programmatic use
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
  normalizeId,
  parseMarkdownTableData,
  recreateBlock,
  richTextToMd,
  safeName,
  splitTableRow,
  textToRichText,
  toCamelCase,
};
