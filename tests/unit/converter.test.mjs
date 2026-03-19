import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blocksToMarkdown,
  markdownToBlocks,
  recreateBlock,
  richTextToMd,
  textToRichText,
} from "../../scripts/actions.mjs";

describe("richTextToMd", () => {
  it("returns empty string for null/undefined/empty", () => {
    assert.equal(richTextToMd(null), "");
    assert.equal(richTextToMd(undefined), "");
    assert.equal(richTextToMd([]), "");
  });

  it("applies annotations in correct order: code→bold→italic→strike→underline→link", () => {
    const rt = [
      {
        plain_text: "text",
        annotations: { code: true, bold: true, italic: true, strikethrough: true, underline: true },
        href: "https://example.com",
      },
    ];
    const result = richTextToMd(rt);
    // code innermost, link outermost
    assert.ok(result.includes("`text`"));
    assert.ok(result.startsWith("["));
    assert.ok(result.endsWith("(https://example.com)"));
  });

  it("handles plain text with no annotations", () => {
    const rt = [{ plain_text: "hello world", annotations: {} }];
    assert.equal(richTextToMd(rt), "hello world");
  });
});

describe("textToRichText", () => {
  it("returns single empty element for empty/null/undefined", () => {
    for (const input of ["", null, undefined]) {
      const result = textToRichText(input);
      assert.equal(result.length, 1);
      assert.equal(result[0].text.content, "");
    }
  });

  it("auto-chunks at 2000 chars", () => {
    const long = "a".repeat(4500);
    const result = textToRichText(long);
    assert.equal(result.length, 3);
    assert.equal(result[0].text.content.length, 2000);
    assert.equal(result[1].text.content.length, 2000);
    assert.equal(result[2].text.content.length, 500);
  });

  it("preserves content after chunking", () => {
    const text = "x".repeat(3000);
    const result = textToRichText(text);
    const joined = result.map((r) => r.text.content).join("");
    assert.equal(joined, text);
  });
});

describe("markdownToBlocks", () => {
  it("returns empty array for empty/null input", () => {
    assert.deepEqual(markdownToBlocks(""), []);
    assert.deepEqual(markdownToBlocks(null), []);
    assert.deepEqual(markdownToBlocks("   "), []);
  });

  it("parses headings", () => {
    const blocks = markdownToBlocks("# H1\n## H2\n### H3");
    assert.equal(blocks[0].type, "heading_1");
    assert.equal(blocks[1].type, "heading_2");
    assert.equal(blocks[2].type, "heading_3");
  });

  it("parses code blocks with language", () => {
    const blocks = markdownToBlocks("```javascript\nconsole.log('hi');\n```");
    assert.equal(blocks[0].type, "code");
    assert.equal(blocks[0].code.language, "javascript");
  });

  it("parses to-do items", () => {
    const blocks = markdownToBlocks("- [x] done\n- [ ] pending");
    assert.equal(blocks[0].type, "to_do");
    assert.equal(blocks[0].to_do.checked, true);
    assert.equal(blocks[1].to_do.checked, false);
  });

  it("parses bullet and numbered lists", () => {
    const blocks = markdownToBlocks("- bullet\n1. numbered");
    assert.equal(blocks[0].type, "bulleted_list_item");
    assert.equal(blocks[1].type, "numbered_list_item");
  });

  it("parses quotes and dividers", () => {
    const blocks = markdownToBlocks("> quote\n---");
    assert.equal(blocks[0].type, "quote");
    assert.equal(blocks[1].type, "divider");
  });

  it("parses equations", () => {
    const blocks = markdownToBlocks("$E=mc^2$");
    assert.equal(blocks[0].type, "equation");
    assert.equal(blocks[0].equation.expression, "E=mc^2");
  });

  it("defaults to paragraph", () => {
    const blocks = markdownToBlocks("just text");
    assert.equal(blocks[0].type, "paragraph");
  });
});

describe("blocksToMarkdown", () => {
  it("handles all major block types", () => {
    const blocks = [
      { type: "heading_1", heading_1: { rich_text: [{ plain_text: "Title", annotations: {} }] } },
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "text", annotations: {} }] } },
      { type: "divider", divider: {} },
      { type: "unsupported", unsupported: {} },
    ];
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("# Title"));
    assert.ok(md.includes("text"));
    assert.ok(md.includes("---"));
    assert.ok(md.includes("[Unsupported block type]"));
  });

  it("handles unknown block types gracefully", () => {
    const blocks = [{ type: "some_future_type", some_future_type: {} }];
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("[some_future_type]"));
  });

  it("renders children with indentation", () => {
    const blocks = [
      {
        type: "toggle",
        toggle: { rich_text: [{ plain_text: "Toggle", annotations: {} }] },
        children: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "child", annotations: {} }] } }],
      },
    ];
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("  child"));
  });
});

describe("recreateBlock", () => {
  it("returns null for unsupported/child_page/child_database", () => {
    assert.equal(recreateBlock({ type: "unsupported" }), null);
    assert.equal(recreateBlock({ type: "child_page", child_page: {} }), null);
    assert.equal(recreateBlock({ type: "child_database", child_database: {} }), null);
  });

  it("strips read-only fields", () => {
    const block = {
      type: "paragraph",
      id: "abc",
      created_time: "t",
      last_edited_time: "t",
      created_by: {},
      last_edited_by: {},
      archived: false,
      in_trash: false,
      parent: {},
      paragraph: { rich_text: [{ type: "text", text: { content: "hi" } }], id: "x", created_time: "t" },
    };
    const result = recreateBlock(block);
    assert.ok(result);
    assert.equal(result.id, undefined);
    assert.equal(result.paragraph.id, undefined);
    assert.equal(result.paragraph.created_time, undefined);
  });

  it("limits children to 100", () => {
    const children = Array.from({ length: 150 }, (_, i) => ({
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: `${i}` } }] },
    }));
    const block = { type: "toggle", toggle: { rich_text: [] } };
    const result = recreateBlock(block, children);
    assert.ok(result.toggle.children.length <= 100);
  });
});

describe("title stripping (indexOf-based)", () => {
  function stripTitle(md) {
    const firstNewlines = md.indexOf("\n\n");
    return firstNewlines >= 0 ? md.slice(firstNewlines + 2) : md;
  }

  it("strips normal title", () => {
    assert.equal(stripTitle("# My Page\n\nContent here"), "Content here");
  });

  it("strips title with special regex chars", () => {
    assert.equal(stripTitle("# Price: $100 (50% off)\n\nDetails"), "Details");
  });

  it("strips title with parentheses and brackets", () => {
    assert.equal(stripTitle("# [Draft] Title (v2)\n\nBody"), "Body");
  });

  it("returns full text if no double newline", () => {
    assert.equal(stripTitle("# Title only"), "# Title only");
  });

  it("handles empty content after title", () => {
    assert.equal(stripTitle("# Title\n\n"), "");
  });

  it("handles multiple double newlines (strips only first)", () => {
    assert.equal(stripTitle("# Title\n\nPara 1\n\nPara 2"), "Para 1\n\nPara 2");
  });

  it("handles title with newline in it", () => {
    // getPage always produces "# Title\n\n..." so title line won't contain \n
    // but if content starts right after first \n\n, it still works
    assert.equal(stripTitle("# T\n\nA\nB"), "A\nB");
  });
});
