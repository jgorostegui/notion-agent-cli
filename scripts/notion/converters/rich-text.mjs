/** Convert Notion rich_text array to markdown. Annotation order: code→bold→italic→strike→underline→link */
export function richTextToMd(richText) {
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

/** Clone a mention from API response shape to request shape (strips name, avatar_url, etc.) */
export function _cloneMention(mention) {
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
export function _cloneRichTextArray(arr) {
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
export function textToRichText(text) {
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
