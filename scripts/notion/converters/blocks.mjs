import { _cloneRichTextArray, richTextToMd, textToRichText } from "./rich-text.mjs";
import { isTableSeparator, splitTableRow } from "./tables.mjs";

/** Convert block tree to markdown string */
export function blocksToMarkdown(blocks, indent = 0) {
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
        const icon = content.icon?.emoji || "\u{1F4A1}";
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
        lines.push(`${prefix}\u{1F4C4} **[Subpage: ${content.title || "Untitled"}]** (id: ${block.id})`);
        break;
      case "child_database":
        lines.push(`${prefix}\u{1F5C3}\uFE0F **[Database: ${content.title || "Untitled"}]** (id: ${block.id})`);
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

/** Parse markdown into Notion block objects */
export function markdownToBlocks(md) {
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
export function makeTextBlock(type, text) {
  return { object: "block", type, [type]: { rich_text: textToRichText(text) } };
}

export function makeHeadingBlock(level, text) {
  const type = `heading_${level}`;
  return { object: "block", type, [type]: { rich_text: textToRichText(text) } };
}

export function makeCodeBlock(code, language = "plain text") {
  return { object: "block", type: "code", code: { rich_text: textToRichText(code), language } };
}

/** Clone a block for create/append API. Strips read-only fields. Returns null for unsupported types. */
export function recreateBlock(block, children = []) {
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
export function _sanitizeBlockForCreate(block) {
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
export function _splitDeepChildren(blocks, _maxDepth = 2) {
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
