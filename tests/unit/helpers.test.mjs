import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  _cloneMention,
  _clonePageCover,
  _clonePageIcon,
  _cloneRichTextArray,
  _splitDeepChildren,
  buildPropertyValue,
  clonePropertyValue,
  csvEscape,
  extractDbTitle,
  extractPropertyValue,
  extractTitle,
  inferColumnTypes,
  isTableSeparator,
  NotionActions,
  normalizeId,
  parseMarkdownTableData,
  safeName,
  splitTableRow,
} from "../../scripts/actions.mjs";

describe("extractTitle", () => {
  it("extracts title from page properties", () => {
    const page = { properties: { Name: { type: "title", title: [{ plain_text: "My Page" }] } } };
    assert.equal(extractTitle(page), "My Page");
  });

  it("returns Untitled for missing title", () => {
    assert.equal(extractTitle({ properties: {} }), "Untitled");
    assert.equal(extractTitle({}), "Untitled");
  });
});

describe("extractDbTitle", () => {
  it("extracts title from database object", () => {
    const db = { title: [{ plain_text: "My DB" }] };
    assert.equal(extractDbTitle(db), "My DB");
  });

  it("returns Untitled for empty title", () => {
    assert.equal(extractDbTitle({ title: [] }), "Untitled");
  });
});

describe("extractPropertyValue", () => {
  it("handles all property types", () => {
    assert.equal(extractPropertyValue({ type: "title", title: [{ plain_text: "T" }] }), "T");
    assert.equal(extractPropertyValue({ type: "number", number: 42 }), "42");
    assert.equal(extractPropertyValue({ type: "select", select: { name: "A" } }), "A");
    assert.equal(extractPropertyValue({ type: "checkbox", checkbox: true }), "true");
    assert.equal(extractPropertyValue({ type: "url", url: "https://x.com" }), "https://x.com");
    assert.equal(extractPropertyValue({ type: "email", email: "a@b.c" }), "a@b.c");
    assert.equal(extractPropertyValue({ type: "status", status: { name: "Done" } }), "Done");
    assert.equal(extractPropertyValue({ type: "date", date: { start: "2024-01-01" } }), "2024-01-01");
    assert.equal(
      extractPropertyValue({ type: "created_time", created_time: "2024-01-01T00:00:00Z" }),
      "2024-01-01T00:00:00Z",
    );
  });

  it("returns empty string for null/undefined", () => {
    assert.equal(extractPropertyValue(null), "");
    assert.equal(extractPropertyValue(undefined), "");
    assert.equal(extractPropertyValue({}), "");
  });
});

describe("buildPropertyValue", () => {
  it("builds title", () => {
    const r = buildPropertyValue("title", "Hello");
    assert.deepEqual(r, { title: [{ text: { content: "Hello" } }] });
  });

  it("builds number", () => {
    assert.deepEqual(buildPropertyValue("number", 42), { number: 42 });
  });

  it("builds select", () => {
    assert.deepEqual(buildPropertyValue("select", "A"), { select: { name: "A" } });
  });

  it("builds multi_select from array", () => {
    const r = buildPropertyValue("multi_select", ["A", "B"]);
    assert.deepEqual(r, { multi_select: [{ name: "A" }, { name: "B" }] });
  });

  it("builds checkbox", () => {
    assert.deepEqual(buildPropertyValue("checkbox", true), { checkbox: true });
  });

  it("returns empty object for unknown type", () => {
    assert.deepEqual(buildPropertyValue("unknown", "x"), {});
  });
});

describe("normalizeId", () => {
  it("converts 32-char hex to hyphenated UUID", () => {
    assert.equal(normalizeId("123456781234123412341234567890ab"), "12345678-1234-1234-1234-1234567890ab");
  });

  it("leaves already-hyphenated UUID unchanged", () => {
    const uuid = "12345678-1234-1234-1234-567890abcdef";
    assert.equal(normalizeId(uuid), uuid);
  });

  it("is idempotent", () => {
    const hex = "123456781234123412341234567890ab";
    assert.equal(normalizeId(normalizeId(hex)), normalizeId(hex));
  });

  it("handles null/undefined gracefully", () => {
    assert.equal(normalizeId(null), null);
    assert.equal(normalizeId(undefined), undefined);
  });
});

describe("safeName", () => {
  it("removes special characters", () => {
    assert.equal(safeName("Hello/World!@#$"), "HelloWorld");
  });

  it("limits to 50 chars", () => {
    const long = "a".repeat(100);
    assert.ok(safeName(long).length <= 50);
  });

  it("preserves spaces and hyphens", () => {
    assert.equal(safeName("My Page - Draft"), "My Page - Draft");
  });
});

describe("csvEscape", () => {
  it("wraps value in double quotes", () => {
    assert.equal(csvEscape("hello"), '"hello"');
  });

  it("escapes internal double quotes", () => {
    assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  });

  it("replaces newlines with spaces", () => {
    assert.equal(csvEscape("line1\nline2"), '"line1 line2"');
    assert.equal(csvEscape("line1\r\nline2"), '"line1 line2"');
    assert.equal(csvEscape("a\n\n\nb"), '"a b"');
  });

  it("handles null and undefined", () => {
    assert.equal(csvEscape(null), '""');
    assert.equal(csvEscape(undefined), '""');
  });

  it("converts numbers to strings", () => {
    assert.equal(csvEscape(42), '"42"');
  });

  it("handles empty string", () => {
    assert.equal(csvEscape(""), '""');
  });
});

// ── Table Parsing Helpers ─────────────────────────────────────────────────────

describe("splitTableRow", () => {
  it("splits a pipe-delimited row into trimmed cells", () => {
    assert.deepEqual(splitTableRow("| A | B | C |"), ["A", "B", "C"]);
  });

  it("returns null for lines not starting with pipe", () => {
    assert.equal(splitTableRow("no pipes here"), null);
  });

  it("returns null for lines not ending with pipe", () => {
    assert.equal(splitTableRow("| A | B"), null);
  });

  it("handles single cell", () => {
    assert.deepEqual(splitTableRow("| solo |"), ["solo"]);
  });

  it("handles empty cells", () => {
    assert.deepEqual(splitTableRow("|  | val |  |"), ["", "val", ""]);
  });

  it("trims whitespace from cells", () => {
    assert.deepEqual(splitTableRow("|  hello  |  world  |"), ["hello", "world"]);
  });
});

describe("isTableSeparator", () => {
  it("matches plain separator", () => {
    assert.equal(isTableSeparator("| --- | --- |"), true);
  });

  it("matches left-aligned", () => {
    assert.equal(isTableSeparator("| :--- | --- |"), true);
  });

  it("matches right-aligned", () => {
    assert.equal(isTableSeparator("| ---: | --- |"), true);
  });

  it("matches center-aligned", () => {
    assert.equal(isTableSeparator("| :---: | :---: |"), true);
  });

  it("matches minimal dashes", () => {
    assert.equal(isTableSeparator("| - | - |"), true);
  });

  it("rejects non-separator rows", () => {
    assert.equal(isTableSeparator("| A | B |"), false);
  });

  it("rejects non-pipe lines", () => {
    assert.equal(isTableSeparator("---"), false);
  });
});

describe("parseMarkdownTableData", () => {
  it("extracts headers and rows from a valid table", () => {
    const md = "| Name | Score |\n| --- | --- |\n| Alice | 95 |\n| Bob | 82 |";
    const result = parseMarkdownTableData(md);
    assert.deepEqual(result.headers, ["Name", "Score"]);
    assert.deepEqual(result.rows, [
      ["Alice", "95"],
      ["Bob", "82"],
    ]);
  });

  it("returns null for non-table content", () => {
    assert.equal(parseMarkdownTableData("just some text"), null);
    assert.equal(parseMarkdownTableData(""), null);
  });

  it("returns null when separator row is missing", () => {
    assert.equal(parseMarkdownTableData("| A | B |\n| 1 | 2 |"), null);
  });

  it("handles empty cells", () => {
    const md = "| A | B |\n| --- | --- |\n|  | val |";
    const result = parseMarkdownTableData(md);
    assert.deepEqual(result.rows, [["", "val"]]);
  });

  it("trims whitespace from cells", () => {
    const md = "|  Name  |  Score  |\n| --- | --- |\n|  Alice  |  95  |";
    const result = parseMarkdownTableData(md);
    assert.deepEqual(result.headers, ["Name", "Score"]);
    assert.deepEqual(result.rows, [["Alice", "95"]]);
  });

  it("normalizes blank headers", () => {
    const md = "|  | Name |  |\n| --- | --- | --- |\n| a | b | c |";
    const result = parseMarkdownTableData(md);
    assert.deepEqual(result.headers, ["Column 1", "Name", "Column 3"]);
  });

  it("de-duplicates repeated headers", () => {
    const md = "| Status | Status | Status |\n| --- | --- | --- |\n| a | b | c |";
    const result = parseMarkdownTableData(md);
    assert.deepEqual(result.headers, ["Status", "Status 2", "Status 3"]);
  });

  it("pads short rows and truncates long rows to header count", () => {
    const md = "| A | B | C |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |";
    const result = parseMarkdownTableData(md);
    assert.deepEqual(result.rows[0], ["1", "", ""]);
    assert.deepEqual(result.rows[1], ["1", "2", "3"]);
  });

  it("handles header-only table (no data rows)", () => {
    const md = "| A | B |\n| --- | --- |";
    const result = parseMarkdownTableData(md);
    assert.deepEqual(result.headers, ["A", "B"]);
    assert.deepEqual(result.rows, []);
  });

  it("accepts alignment separators", () => {
    const md = "| Name | Score |\n| :--- | ---: |\n| Alice | 95 |";
    const result = parseMarkdownTableData(md);
    assert.deepEqual(result.headers, ["Name", "Score"]);
  });
});

describe("inferColumnTypes", () => {
  it("assigns title to first column", () => {
    const types = inferColumnTypes(["Name", "Other"], [["Alice", "x"]]);
    assert.equal(types.Name, "title");
  });

  it("infers number for all-numeric column", () => {
    const types = inferColumnTypes(
      ["Name", "Score"],
      [
        ["A", "95"],
        ["B", "82"],
        ["C", "-3.5"],
      ],
    );
    assert.equal(types.Score, "number");
  });

  it("keeps leading-zero values as rich_text", () => {
    const types = inferColumnTypes(
      ["Name", "Code"],
      [
        ["A", "00123"],
        ["B", "00456"],
      ],
    );
    assert.equal(types.Code, "rich_text");
  });

  it("infers url for URL values", () => {
    const types = inferColumnTypes(
      ["Name", "Link"],
      [
        ["A", "https://example.com"],
        ["B", "http://test.org"],
      ],
    );
    assert.equal(types.Link, "url");
  });

  it("infers date for date values", () => {
    const types = inferColumnTypes(
      ["Name", "Date"],
      [
        ["A", "2024-01-15"],
        ["B", "2025-12-31"],
      ],
    );
    assert.equal(types.Date, "date");
  });

  it("infers checkbox for boolean-like values", () => {
    const types = inferColumnTypes(
      ["Name", "Done"],
      [
        ["A", "true"],
        ["B", "false"],
        ["C", "yes"],
      ],
    );
    assert.equal(types.Done, "checkbox");
  });

  it("infers email for email values", () => {
    const types = inferColumnTypes(
      ["Name", "Email"],
      [
        ["A", "a@b.com"],
        ["B", "x@y.org"],
      ],
    );
    assert.equal(types.Email, "email");
  });

  it("infers select for small categorical columns with repeats", () => {
    const types = inferColumnTypes(
      ["Name", "Status"],
      [
        ["A", "Done"],
        ["B", "In Progress"],
        ["C", "Done"],
      ],
    );
    assert.equal(types.Status, "select");
  });

  it("defaults to rich_text for mixed values", () => {
    const types = inferColumnTypes(
      ["Name", "Notes"],
      [
        ["A", "hello"],
        ["B", "42"],
        ["C", "https://x.com"],
      ],
    );
    assert.equal(types.Notes, "rich_text");
  });

  it("defaults to rich_text for empty column", () => {
    const types = inferColumnTypes(
      ["Name", "Empty"],
      [
        ["A", ""],
        ["B", ""],
      ],
    );
    assert.equal(types.Empty, "rich_text");
  });

  it("ignores blank cells when inferring", () => {
    const types = inferColumnTypes(
      ["Name", "Score"],
      [
        ["A", "95"],
        ["B", ""],
        ["C", "82"],
      ],
    );
    assert.equal(types.Score, "number");
  });
});

describe("batchSetProperties error reporting", () => {
  it("returns errors array with failed IDs", async () => {
    const actions = new NotionActions("ntn_test_token");
    let _callCount = 0;
    actions.setProperties = async (id) => {
      _callCount++;
      if (id === "bad-id") throw new Error("Not found");
    };
    const result = await actions.batchSetProperties(["good-id", "bad-id", "good-id2"], {});
    assert.equal(result.updated, 2);
    assert.equal(result.total, 3);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].id, "bad-id");
    assert.ok(result.errors[0].error.includes("Not found"));
  });

  it("returns empty errors array on full success", async () => {
    const actions = new NotionActions("ntn_test_token");
    actions.setProperties = async () => {};
    const result = await actions.batchSetProperties(["id1", "id2"], {});
    assert.equal(result.updated, 2);
    assert.deepEqual(result.errors, []);
  });
});

describe("batchArchive error reporting", () => {
  it("returns errors array with failed IDs", async () => {
    const actions = new NotionActions("ntn_test_token");
    actions._call = async (fn) => fn();
    actions.client = {
      pages: {
        update: async ({ page_id }) => {
          if (page_id.includes("bad")) throw new Error("Forbidden");
        },
      },
    };
    const result = await actions.batchArchive(["good-id", "bad-id"]);
    assert.equal(result.archived, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].id, "bad-id");
    assert.ok(result.errors[0].error.includes("Forbidden"));
  });

  it("returns empty errors array on full success", async () => {
    const actions = new NotionActions("ntn_test_token");
    actions._call = async (fn) => fn();
    actions.client = { pages: { update: async () => ({}) } };
    const result = await actions.batchArchive(["id1"]);
    assert.equal(result.archived, 1);
    assert.deepEqual(result.errors, []);
  });
});

// ── Clone helpers ───────────────────────────────────────────────────────────

describe("_cloneMention", () => {
  it("strips response-only fields from user mentions", () => {
    const result = _cloneMention({
      type: "user",
      user: { id: "u1", name: "Alice", avatar_url: "https://example.com/a.png" },
    });
    assert.deepEqual(result, { type: "user", user: { id: "u1" } });
  });

  it("produces correct request shape for page/database/date mentions", () => {
    assert.deepEqual(_cloneMention({ type: "page", page: { id: "p1" } }), { type: "page", page: { id: "p1" } });
    assert.deepEqual(_cloneMention({ type: "database", database: { id: "d1" } }), {
      type: "database",
      database: { id: "d1" },
    });
    assert.deepEqual(
      _cloneMention({ type: "date", date: { start: "2026-01-01", end: "2026-01-02" } }).date.end,
      "2026-01-02",
    );
  });

  it("returns undefined for unknown mention types", () => {
    assert.equal(_cloneMention({ type: "unknown_thing", data: {} }), undefined);
  });
});

describe("_cloneRichTextArray", () => {
  it("preserves bold, italic, link annotations", () => {
    const input = [
      {
        type: "text",
        text: { content: "bold" },
        annotations: {
          bold: true,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
      },
      {
        type: "text",
        text: { content: "link", link: { url: "https://example.com" } },
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
      },
    ];
    const result = _cloneRichTextArray(input);
    assert.equal(result.length, 2);
    assert.ok(result[0].annotations.bold);
    assert.deepEqual(result[1].text.link, { url: "https://example.com" });
  });

  it("filters out unrecognized mention types without URL", () => {
    const input = [
      { type: "text", text: { content: "hello" } },
      { type: "mention", mention: { type: "unknown_x" } },
      { type: "text", text: { content: "world" } },
    ];
    const result = _cloneRichTextArray(input);
    assert.equal(result.length, 2);
  });

  it("converts link_preview mentions to clickable text links", () => {
    const input = [
      {
        type: "mention",
        mention: { type: "link_preview", link_preview: { url: "https://github.com/foo" } },
        plain_text: "https://github.com/foo",
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
      },
    ];
    const result = _cloneRichTextArray(input);
    assert.equal(result[0].type, "text");
    assert.deepEqual(result[0].text.link, { url: "https://github.com/foo" });
  });

  it("converts link_mention mentions to clickable text links (href field)", () => {
    const input = [
      {
        type: "mention",
        mention: {
          type: "link_mention",
          link_mention: { href: "https://console.aws.amazon.com", title: "AWS Console" },
        },
        plain_text: "https://console.aws.amazon.com",
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
      },
    ];
    const result = _cloneRichTextArray(input);
    assert.equal(result[0].type, "text");
    assert.deepEqual(result[0].text.link, { url: "https://console.aws.amazon.com" });
  });

  it("strips default-only annotations", () => {
    const input = [
      {
        type: "text",
        text: { content: "plain" },
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
      },
    ];
    assert.equal(_cloneRichTextArray(input)[0].annotations, undefined);
  });

  it("returns fallback for empty input", () => {
    assert.deepEqual(_cloneRichTextArray([]), [{ type: "text", text: { content: "" } }]);
    assert.deepEqual(_cloneRichTextArray(null), [{ type: "text", text: { content: "" } }]);
  });
});

describe("clonePropertyValue", () => {
  it("clones supported types correctly", () => {
    assert.deepEqual(clonePropertyValue({ type: "number", number: 42 }), { number: 42 });
    assert.deepEqual(clonePropertyValue({ type: "checkbox", checkbox: true }), { checkbox: true });
    assert.deepEqual(clonePropertyValue({ type: "url", url: "https://x.com" }), { url: "https://x.com" });
    assert.deepEqual(clonePropertyValue({ type: "email", email: "a@b.com" }), { email: "a@b.com" });
    assert.deepEqual(clonePropertyValue({ type: "phone_number", phone_number: "+1-555" }), { phone_number: "+1-555" });
    assert.deepEqual(clonePropertyValue({ type: "select", select: { id: "s1", name: "A", color: "red" } }), {
      select: { name: "A" },
    });
    assert.deepEqual(clonePropertyValue({ type: "status", status: { name: "Done" } }), { status: { name: "Done" } });
    assert.deepEqual(clonePropertyValue({ type: "people", people: [{ id: "u1", name: "Alice" }] }), {
      people: [{ id: "u1" }],
    });
  });

  it("preserves full date object including end and time_zone", () => {
    const dateObj = { start: "2026-01-01", end: "2026-01-02", time_zone: "America/New_York" };
    assert.deepEqual(clonePropertyValue({ type: "date", date: dateObj }), { date: dateObj });
  });

  it("preserves rich text formatting in title/rich_text", () => {
    const rt = [
      {
        type: "text",
        text: { content: "bold" },
        annotations: {
          bold: true,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
      },
    ];
    assert.ok(clonePropertyValue({ type: "title", title: rt }).title[0].annotations.bold);
  });

  it("returns undefined for unsupported types", () => {
    for (const type of ["formula", "rollup", "relation", "files", "created_time", "unique_id"]) {
      assert.equal(clonePropertyValue({ type, [type]: {} }), undefined, `${type} should return undefined`);
    }
    assert.equal(clonePropertyValue(null), undefined);
  });
});

describe("_clonePageIcon", () => {
  it("passes through emoji, external, and named icon types", () => {
    assert.deepEqual(_clonePageIcon({ type: "emoji", emoji: "🎯" }), { type: "emoji", emoji: "🎯" });
    assert.deepEqual(
      _clonePageIcon({ type: "external", external: { url: "https://example.com/icon.png" } }).type,
      "external",
    );
    assert.deepEqual(
      _clonePageIcon({ type: "icon", icon: { name: "book-closed", color: "blue" } }).icon.name,
      "book-closed",
    );
  });

  it("returns undefined for Notion-hosted file icons", () => {
    assert.equal(_clonePageIcon({ type: "file", file: { url: "https://prod-files-secure.s3..." } }), undefined);
  });

  it("returns undefined for null/undefined", () => {
    assert.equal(_clonePageIcon(null), undefined);
    assert.equal(_clonePageIcon(undefined), undefined);
  });
});

describe("_clonePageCover", () => {
  it("passes through external covers", () => {
    assert.deepEqual(
      _clonePageCover({ type: "external", external: { url: "https://example.com/cover.png" } }).type,
      "external",
    );
  });

  it("returns undefined for Notion-hosted file covers", () => {
    assert.equal(_clonePageCover({ type: "file", file: { url: "https://prod-files-secure.s3..." } }), undefined);
  });
});

// ── _splitDeepChildren ──────────────────────────────────────────────────────

function makeListBlock(type, text, children) {
  const block = { object: "block", type, [type]: { rich_text: [{ type: "text", text: { content: text } }] } };
  if (children?.length) block[type].children = children;
  return block;
}

describe("_splitDeepChildren", () => {
  it("returns empty deferred for <=2 levels", () => {
    const blocks = [makeListBlock("bulleted_list_item", "L1", [makeListBlock("bulleted_list_item", "L2")])];
    const { deferred } = _splitDeepChildren(blocks, 2);
    assert.equal(deferred.length, 0);
  });

  it("strips level-3 children into deferred", () => {
    const blocks = [
      makeListBlock("bulleted_list_item", "L1", [
        makeListBlock("bulleted_list_item", "L2", [makeListBlock("bulleted_list_item", "L3")]),
      ]),
    ];
    const { truncated, deferred } = _splitDeepChildren(blocks, 2);
    assert.equal(deferred.length, 1);
    assert.equal(deferred[0].topIndex, 0);
    assert.equal(deferred[0].childIndex, 0);
    assert.equal(truncated[0].bulleted_list_item.children[0].bulleted_list_item.children, undefined);
  });

  it("handles 4+ level nesting", () => {
    const blocks = [
      makeListBlock("bulleted_list_item", "L1", [
        makeListBlock("bulleted_list_item", "L2", [
          makeListBlock("bulleted_list_item", "L3", [makeListBlock("bulleted_list_item", "L4")]),
        ]),
      ]),
    ];
    const { deferred } = _splitDeepChildren(blocks, 2);
    assert.ok(deferred[0].children[0].bulleted_list_item.children);
  });

  it("does not mutate original blocks", () => {
    const inner = makeListBlock("bulleted_list_item", "L3");
    const blocks = [makeListBlock("bulleted_list_item", "L1", [makeListBlock("bulleted_list_item", "L2", [inner])])];
    _splitDeepChildren(blocks, 2);
    assert.ok(blocks[0].bulleted_list_item.children[0].bulleted_list_item.children);
  });
});
