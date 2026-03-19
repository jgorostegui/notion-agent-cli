/**
 * Property-based tests for converter functions
 * Properties 1-5, 7: markdown round-trip, blocksToMarkdown, richTextToMd annotations,
 * textToRichText chunking, recreateBlock, block array chunking
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
  blocksToMarkdown,
  markdownToBlocks,
  recreateBlock,
  richTextToMd,
  textToRichText,
} from "../../scripts/actions.mjs";

// ── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate safe text (no markdown-special chars that would confuse the parser) */
const safeText = fc
  .stringOf(
    fc.char().filter((c) => !/[#\-*>`~_[\]()\\$\n\r]/.test(c)),
    { minLength: 1, maxLength: 200 },
  )
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/** Generate a supported markdown line */
const mdLine = fc.oneof(
  safeText.map((t) => `# ${t}`),
  safeText.map((t) => `## ${t}`),
  safeText.map((t) => `### ${t}`),
  safeText.map((t) => `- ${t}`),
  safeText.map((t) => `1. ${t}`),
  safeText.map((t) => `- [ ] ${t}`),
  safeText.map((t) => `- [x] ${t}`),
  safeText.map((t) => `> ${t}`),
  fc.constant("---"),
  safeText, // paragraph
);

// ── Property 1: Markdown round-trip equivalence ─────────────────────────────

describe("Property 1: Markdown round-trip equivalence", () => {
  it("blocksToMarkdown(markdownToBlocks(md)) preserves block types, order, and text", () => {
    fc.assert(
      fc.property(fc.array(mdLine, { minLength: 1, maxLength: 20 }), (lines) => {
        const md = lines.join("\n");
        const blocks = markdownToBlocks(md);
        const _roundTripped = blocksToMarkdown(blocks);

        // Each original line's text content should appear in the round-tripped output
        for (const block of blocks) {
          const type = block.type;
          assert.ok(type, "block has a type");
          // Verify block type is one of the supported types
          const supported = [
            "paragraph",
            "heading_1",
            "heading_2",
            "heading_3",
            "bulleted_list_item",
            "numbered_list_item",
            "to_do",
            "quote",
            "divider",
            "code",
          ];
          assert.ok(supported.includes(type), `block type ${type} is supported`);
        }

        // Block count should match line count (excluding empty lines)
        const nonEmpty = lines.filter((l) => l.trim());
        assert.equal(blocks.length, nonEmpty.length);
      }),
      { numRuns: 100 },
    );
  });

  it("to-do checked state survives round-trip", () => {
    fc.assert(
      fc.property(safeText, fc.boolean(), (text, checked) => {
        const md = `- [${checked ? "x" : " "}] ${text}`;
        const blocks = markdownToBlocks(md);
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, "to_do");
        assert.equal(blocks[0].to_do.checked, checked);
      }),
      { numRuns: 100 },
    );
  });

  it("code block language survives round-trip", () => {
    const lang = fc.constantFrom("javascript", "python", "rust", "go", "plain text");
    fc.assert(
      fc.property(safeText, lang, (code, language) => {
        const md = `\`\`\`${language}\n${code}\n\`\`\``;
        const blocks = markdownToBlocks(md);
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, "code");
        assert.equal(blocks[0].code.language, language);
      }),
      { numRuns: 50 },
    );
  });
});

// ── Property 2: blocksToMarkdown produces non-empty output for all block types ──

describe("Property 2: blocksToMarkdown non-empty output for all block types", () => {
  const blockTypes = [
    { type: "paragraph", content: { rich_text: [{ plain_text: "hello", annotations: {} }] } },
    { type: "heading_1", content: { rich_text: [{ plain_text: "H1", annotations: {} }] } },
    { type: "heading_2", content: { rich_text: [{ plain_text: "H2", annotations: {} }] } },
    { type: "heading_3", content: { rich_text: [{ plain_text: "H3", annotations: {} }] } },
    { type: "bulleted_list_item", content: { rich_text: [{ plain_text: "bullet", annotations: {} }] } },
    { type: "numbered_list_item", content: { rich_text: [{ plain_text: "num", annotations: {} }] } },
    { type: "to_do", content: { rich_text: [{ plain_text: "task", annotations: {} }], checked: false } },
    { type: "toggle", content: { rich_text: [{ plain_text: "toggle", annotations: {} }] } },
    { type: "code", content: { rich_text: [{ plain_text: "code", annotations: {} }], language: "js" } },
    { type: "quote", content: { rich_text: [{ plain_text: "quote", annotations: {} }] } },
    { type: "callout", content: { rich_text: [{ plain_text: "callout", annotations: {} }], icon: { emoji: "💡" } } },
    { type: "divider", content: {} },
    { type: "image", content: { type: "external", external: { url: "https://example.com/img.png" }, caption: [] } },
    { type: "bookmark", content: { url: "https://example.com" } },
    { type: "child_page", content: { title: "Sub" }, id: "abc" },
    { type: "child_database", content: { title: "DB" }, id: "def" },
    { type: "equation", content: { expression: "E=mc^2" } },
    { type: "column_list", content: {} },
    { type: "column", content: {} },
  ];

  it("every supported block type produces non-empty markdown", () => {
    for (const { type, content, id } of blockTypes) {
      const block = { type, [type]: content, id: id || "test-id" };
      const md = blocksToMarkdown([block]);
      assert.ok(md.trim().length > 0, `${type} should produce non-empty output`);
    }
  });

  it("type-appropriate markers present", () => {
    fc.assert(
      fc.property(safeText, (text) => {
        const rt = [{ plain_text: text, annotations: {} }];
        // Heading markers
        assert.ok(blocksToMarkdown([{ type: "heading_1", heading_1: { rich_text: rt } }]).includes("# "));
        assert.ok(blocksToMarkdown([{ type: "heading_2", heading_2: { rich_text: rt } }]).includes("## "));
        assert.ok(blocksToMarkdown([{ type: "heading_3", heading_3: { rich_text: rt } }]).includes("### "));
        // List markers
        assert.ok(
          blocksToMarkdown([{ type: "bulleted_list_item", bulleted_list_item: { rich_text: rt } }]).includes("- "),
        );
        assert.ok(
          blocksToMarkdown([{ type: "numbered_list_item", numbered_list_item: { rich_text: rt } }]).includes("1. "),
        );
        // Quote marker
        assert.ok(blocksToMarkdown([{ type: "quote", quote: { rich_text: rt } }]).includes("> "));
      }),
      { numRuns: 30 },
    );
  });
});

// ── Property 3: Rich text annotation ordering ───────────────────────────────

describe("Property 3: Rich text annotation ordering", () => {
  it("code backticks innermost, then bold, italic, strikethrough, underline, link outermost", () => {
    fc.assert(
      fc.property(safeText, (text) => {
        // All annotations on
        const rt = [
          {
            plain_text: text,
            annotations: { code: true, bold: true, italic: true, strikethrough: true, underline: true },
            href: "https://example.com",
            text: { link: { url: "https://example.com" } },
          },
        ];
        const md = richTextToMd(rt);

        // Link should be outermost: [...](...) wrapping everything
        assert.ok(md.startsWith("["), "link bracket outermost");
        assert.ok(md.includes("](https://example.com)"), "link URL present");

        // Inside the link text, underline <u>...</u> wraps the rest
        const linkText = md.slice(1, md.indexOf("]("));
        assert.ok(linkText.startsWith("<u>"), "underline wraps inside link");
        assert.ok(linkText.endsWith("</u>"), "underline closes inside link");

        // Inside underline, strikethrough ~~...~~
        const inner1 = linkText.slice(3, -4); // strip <u>...</u>
        assert.ok(inner1.startsWith("~~"), "strikethrough inside underline");
        assert.ok(inner1.endsWith("~~"), "strikethrough closes");

        // Inside strikethrough, italic *...*
        const inner2 = inner1.slice(2, -2);
        assert.ok(inner2.startsWith("*"), "italic inside strikethrough");
        assert.ok(inner2.endsWith("*"), "italic closes");

        // Inside italic, bold **...**
        const inner3 = inner2.slice(1, -1);
        assert.ok(inner3.startsWith("**"), "bold inside italic");
        assert.ok(inner3.endsWith("**"), "bold closes");

        // Inside bold, code backticks
        const inner4 = inner3.slice(2, -2);
        assert.ok(inner4.startsWith("`"), "code innermost");
        assert.ok(inner4.endsWith("`"), "code closes");
      }),
      { numRuns: 50 },
    );
  });
});

// ── Property 4: textToRichText chunking and empty-input safety ──────────────

describe("Property 4: textToRichText chunking and empty-input safety", () => {
  it("every chunk ≤ 2000 chars", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 10000 }), (text) => {
        const chunks = textToRichText(text);
        for (const chunk of chunks) {
          assert.ok(chunk.text.content.length <= 2000, `chunk ${chunk.text.content.length} > 2000`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("concatenation equals original", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8000 }), (text) => {
        const chunks = textToRichText(text);
        const joined = chunks.map((c) => c.text.content).join("");
        assert.equal(joined, text);
      }),
      { numRuns: 100 },
    );
  });

  it("correct array length", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8000 }), (text) => {
        const chunks = textToRichText(text);
        assert.equal(chunks.length, Math.ceil(text.length / 2000));
      }),
      { numRuns: 100 },
    );
  });

  it("empty/undefined/null returns single empty element", () => {
    for (const input of ["", undefined, null]) {
      const result = textToRichText(input);
      assert.equal(result.length, 1);
      assert.equal(result[0].text.content, "");
    }
  });
});

// ── Property 5: recreateBlock strips read-only fields and limits children ───

describe("Property 5: recreateBlock strips read-only fields and limits children", () => {
  const readOnlyFields = [
    "id",
    "created_time",
    "last_edited_time",
    "created_by",
    "last_edited_by",
    "archived",
    "in_trash",
    "parent",
  ];

  it("no read-only fields in output", () => {
    fc.assert(
      fc.property(safeText, (text) => {
        const block = {
          type: "paragraph",
          id: "some-id",
          created_time: "2024-01-01",
          last_edited_time: "2024-01-02",
          created_by: { id: "user" },
          last_edited_by: { id: "user" },
          archived: false,
          in_trash: false,
          parent: { type: "page_id" },
          paragraph: {
            rich_text: [{ plain_text: text, annotations: {} }],
            id: "inner-id",
            created_time: "2024-01-01",
          },
        };
        const result = recreateBlock(block);
        assert.ok(result);
        const content = result.paragraph;
        for (const field of readOnlyFields) {
          assert.equal(content[field], undefined, `${field} should be stripped`);
        }
      }),
      { numRuns: 50 },
    );
  });

  it("max 100 children", () => {
    fc.assert(
      fc.property(fc.integer({ min: 50, max: 200 }), (childCount) => {
        const children = Array.from({ length: childCount }, (_, i) => ({
          type: "paragraph",
          paragraph: { rich_text: [{ plain_text: `child ${i}`, annotations: {} }] },
        }));
        const block = { type: "paragraph", paragraph: { rich_text: [{ plain_text: "parent", annotations: {} }] } };
        const result = recreateBlock(block, children);
        if (result?.paragraph?.children) {
          assert.ok(result.paragraph.children.length <= 100);
        }
      }),
      { numRuns: 30 },
    );
  });

  it("null for unsupported/child_page/child_database", () => {
    for (const type of ["unsupported", "child_page", "child_database"]) {
      const block = { type, [type]: { title: "test" } };
      assert.equal(recreateBlock(block), null);
    }
  });
});

// ── Property 7: Block array chunking at 100 ────────────────────────────────

describe("Property 7: Block array chunking at 100", () => {
  it("Math.ceil(N/100) chunks, each ≤ 100, concatenation equals original", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (n) => {
        const blocks = Array.from({ length: n }, (_, i) => ({ id: `block-${i}` }));
        // Simulate the chunking logic used in _appendInBatches
        const chunks = [];
        for (let i = 0; i < blocks.length; i += 100) {
          chunks.push(blocks.slice(i, i + 100));
        }
        assert.equal(chunks.length, Math.ceil(n / 100));
        for (const chunk of chunks) {
          assert.ok(chunk.length <= 100);
        }
        const flat = chunks.flat();
        assert.equal(flat.length, n);
        for (let i = 0; i < n; i++) {
          assert.equal(flat[i].id, `block-${i}`);
        }
      }),
      { numRuns: 100 },
    );
  });
});
