import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPropertyValue,
  csvEscape,
  extractDbTitle,
  extractPropertyValue,
  extractTitle,
  NotionActions,
  normalizeId,
  safeName,
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
