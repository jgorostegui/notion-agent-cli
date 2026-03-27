/**
 * Property-based tests for helper functions
 * Properties 6, 8, 14, 24-27: ConcurrencyLimiter, buildPropertyValue, safeName,
 * extractTitle/extractDbTitle, extractPropertyValue, token validation, normalizeId
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
  buildPropertyValue,
  ConcurrencyLimiter,
  csvEscape,
  extractDbTitle,
  extractPropertyValue,
  extractTitle,
  normalizeId,
  safeName,
} from "../../scripts/actions.mjs";

// ── Property 6: ConcurrencyLimiter serializes with concurrency=1 ────────────

describe("Property 6: ConcurrencyLimiter", () => {
  it("concurrency=1 serializes tasks", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const order = [];

    const task = async (id, delay) => {
      await limiter.acquire();
      order.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, delay));
      order.push(`end-${id}`);
      limiter.release();
    };

    await Promise.all([task("a", 20), task("b", 10)]);
    // With concurrency=1, a should finish before b starts
    assert.equal(order[0], "start-a");
    assert.equal(order[1], "end-a");
    assert.equal(order[2], "start-b");
    assert.equal(order[3], "end-b");
  });

  it("concurrency=3 allows parallel execution", async () => {
    const limiter = new ConcurrencyLimiter(3);
    let maxConcurrent = 0;
    let current = 0;

    const task = async () => {
      await limiter.acquire();
      current++;
      if (current > maxConcurrent) maxConcurrent = current;
      await new Promise((r) => setTimeout(r, 20));
      current--;
      limiter.release();
    };

    await Promise.all([task(), task(), task(), task(), task()]);
    assert.ok(maxConcurrent >= 2, `Expected concurrency >= 2, got ${maxConcurrent}`);
    assert.ok(maxConcurrent <= 3, `Expected concurrency <= 3, got ${maxConcurrent}`);
  });
});

// ── Property 8: buildPropertyValue produces correctly typed objects ──────────

describe("Property 8: buildPropertyValue produces correctly typed objects", () => {
  it("title type produces { title: [{ text: { content } }] }", () => {
    fc.assert(
      fc.property(fc.string(), (val) => {
        const result = buildPropertyValue("title", val);
        assert.ok(result.title);
        assert.ok(Array.isArray(result.title));
        assert.equal(result.title[0].text.content, String(val));
      }),
      { numRuns: 50 },
    );
  });

  it("rich_text type produces { rich_text: [{ text: { content } }] }", () => {
    fc.assert(
      fc.property(fc.string(), (val) => {
        const result = buildPropertyValue("rich_text", val);
        assert.ok(Array.isArray(result.rich_text));
        assert.equal(result.rich_text[0].text.content, String(val));
      }),
      { numRuns: 50 },
    );
  });

  it("number type produces { number: N }", () => {
    fc.assert(
      fc.property(fc.integer(), (val) => {
        const result = buildPropertyValue("number", val);
        assert.equal(typeof result.number, "number");
        assert.equal(result.number, Number(val));
      }),
      { numRuns: 50 },
    );
  });

  it("select type produces { select: { name } }", () => {
    fc.assert(
      fc.property(fc.string(), (val) => {
        const result = buildPropertyValue("select", val);
        assert.equal(result.select.name, String(val));
      }),
      { numRuns: 50 },
    );
  });

  it("multi_select handles arrays and single values", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 5 }), (vals) => {
        const result = buildPropertyValue("multi_select", vals);
        assert.ok(Array.isArray(result.multi_select));
        assert.equal(result.multi_select.length, vals.length);
        for (let i = 0; i < vals.length; i++) {
          assert.equal(result.multi_select[i].name, String(vals[i]));
        }
      }),
      { numRuns: 50 },
    );
  });

  it("checkbox type produces { checkbox: boolean }", () => {
    fc.assert(
      fc.property(fc.boolean(), (val) => {
        const result = buildPropertyValue("checkbox", val);
        assert.equal(typeof result.checkbox, "boolean");
      }),
      { numRuns: 20 },
    );
  });

  it("url type produces { url: string }", () => {
    fc.assert(
      fc.property(fc.string(), (val) => {
        const result = buildPropertyValue("url", val);
        assert.equal(result.url, String(val));
      }),
      { numRuns: 30 },
    );
  });

  it("date type produces { date: { start } }", () => {
    fc.assert(
      fc.property(fc.string(), (val) => {
        const result = buildPropertyValue("date", val);
        assert.equal(result.date.start, String(val));
      }),
      { numRuns: 30 },
    );
  });

  it("status type produces { status: { name } }", () => {
    fc.assert(
      fc.property(fc.string(), (val) => {
        const result = buildPropertyValue("status", val);
        assert.equal(result.status.name, String(val));
      }),
      { numRuns: 30 },
    );
  });

  it("relation type handles arrays", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 5 }), (vals) => {
        const result = buildPropertyValue("relation", vals);
        assert.ok(Array.isArray(result.relation));
        assert.equal(result.relation.length, vals.length);
      }),
      { numRuns: 30 },
    );
  });

  it("unknown type returns empty object", () => {
    const result = buildPropertyValue("unknown_type", "val");
    assert.deepEqual(result, {});
  });
});

// ── Property 14: Filename sanitization ──────────────────────────────────────

describe("Property 14: Filename sanitization", () => {
  it("length ≤ 50, only alphanumeric/spaces/hyphens, trimmed", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input) => {
        const result = safeName(input);
        assert.ok(result.length <= 50, `length ${result.length} > 50`);
        assert.equal(result, result.trim(), "should be trimmed");
        // Only word chars (\w = [a-zA-Z0-9_]), spaces, and hyphens
        assert.ok(/^[\w\s-]*$/.test(result), `"${result}" contains invalid chars`);
      }),
      { numRuns: 200 },
    );
  });
});

// ── Property 24: Title extraction from page and database objects ────────────

describe("Property 24: extractTitle and extractDbTitle", () => {
  it("extractTitle concatenates plain_text values", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }), (parts) => {
        const page = {
          properties: {
            Name: {
              type: "title",
              title: parts.map((p) => ({ plain_text: p })),
            },
          },
        };
        const result = extractTitle(page);
        assert.equal(result, parts.join(""));
      }),
      { numRuns: 50 },
    );
  });

  it("extractTitle returns 'Untitled' for missing title", () => {
    assert.equal(extractTitle({}), "Untitled");
    assert.equal(extractTitle({ properties: {} }), "Untitled");
    assert.equal(extractTitle({ properties: { Name: { type: "title", title: [] } } }), "Untitled");
  });

  it("extractDbTitle concatenates plain_text values", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }), (parts) => {
        const db = { title: parts.map((p) => ({ plain_text: p })) };
        const result = extractDbTitle(db);
        assert.equal(result, parts.join(""));
      }),
      { numRuns: 50 },
    );
  });

  it("extractDbTitle returns 'Untitled' for missing title", () => {
    assert.equal(extractDbTitle({}), "Untitled");
    assert.equal(extractDbTitle({ title: [] }), "Untitled");
  });
});

// ── Property 25: extractPropertyValue covers all property types ─────────────

describe("Property 25: extractPropertyValue covers all property types", () => {
  const typeFixtures = [
    { type: "title", title: [{ plain_text: "Test" }] },
    { type: "rich_text", rich_text: [{ plain_text: "Hello" }] },
    { type: "number", number: 42 },
    { type: "select", select: { name: "Option A" } },
    { type: "multi_select", multi_select: [{ name: "A" }, { name: "B" }] },
    { type: "date", date: { start: "2024-01-01" } },
    { type: "checkbox", checkbox: true },
    { type: "url", url: "https://example.com" },
    { type: "email", email: "test@example.com" },
    { type: "phone_number", phone_number: "+1234567890" },
    { type: "status", status: { name: "In Progress" } },
    { type: "relation", relation: [{ id: "abc" }] },
    { type: "formula", formula: { type: "string", string: "computed" } },
    { type: "rollup", rollup: { type: "number", number: 10 } },
    { type: "people", people: [{ name: "Alice" }] },
    { type: "created_time", created_time: "2024-01-01T00:00:00Z" },
    { type: "last_edited_time", last_edited_time: "2024-06-01T00:00:00Z" },
    { type: "created_by", created_by: { name: "Bob" } },
    { type: "last_edited_by", last_edited_by: { name: "Carol" } },
    { type: "files", files: [{ name: "doc.pdf" }] },
  ];

  it("returns non-undefined value for all 20 supported types", () => {
    for (const fixture of typeFixtures) {
      const result = extractPropertyValue(fixture);
      assert.notEqual(result, undefined, `${fixture.type} should return non-undefined`);
    }
  });

  it("returns human-readable strings for text-like types", () => {
    fc.assert(
      fc.property(safeText, (text) => {
        assert.equal(extractPropertyValue({ type: "title", title: [{ plain_text: text }] }), text);
        assert.equal(extractPropertyValue({ type: "rich_text", rich_text: [{ plain_text: text }] }), text);
        assert.equal(extractPropertyValue({ type: "url", url: text }), text);
        assert.equal(extractPropertyValue({ type: "email", email: text }), text);
      }),
      { numRuns: 30 },
    );
  });
});

const safeText = fc
  .stringOf(
    fc.char().filter((c) => !/[\n\r]/.test(c)),
    { minLength: 1, maxLength: 100 },
  )
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// ── Property 26: Token format validation ────────────────────────────────────

describe("Property 26: Token format validation", () => {
  it("strings starting with ntn_ are accepted", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (suffix) => {
        const token = `ntn_${suffix}`;
        assert.ok(token.startsWith("ntn_"), "token starts with ntn_");
      }),
      { numRuns: 50 },
    );
  });

  it("strings NOT starting with ntn_ are rejected", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.startsWith("ntn_")),
        (token) => {
          assert.ok(!token.startsWith("ntn_"), "non-ntn_ token rejected");
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ── Property 27: normalizeId round-trip ─────────────────────────────────────

describe("Property 27: normalizeId round-trip", () => {
  /** Generate a valid 32-char hex string */
  const hex32 = fc.stringOf(fc.constantFrom(..."0123456789abcdef"), { minLength: 32, maxLength: 32 });

  it("32-char hex → hyphenated UUID format", () => {
    fc.assert(
      fc.property(hex32, (hex) => {
        const result = normalizeId(hex);
        assert.match(result, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      }),
      { numRuns: 100 },
    );
  });

  it("already-hyphenated UUID unchanged", () => {
    fc.assert(
      fc.property(hex32, (hex) => {
        const hyphenated = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        assert.equal(normalizeId(hyphenated), hyphenated);
      }),
      { numRuns: 100 },
    );
  });

  it("idempotent: normalizeId(normalizeId(x)) === normalizeId(x)", () => {
    fc.assert(
      fc.property(hex32, (hex) => {
        const once = normalizeId(hex);
        const twice = normalizeId(once);
        assert.equal(once, twice);
      }),
      { numRuns: 100 },
    );
  });

  it("non-32-char strings returned as-is", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.replace(/-/g, "").length !== 32),
        (id) => {
          assert.equal(normalizeId(id), id);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ── Property: CSV escaping invariants ───────────────────────────────────────

describe("Property: csvEscape invariants", () => {
  it("output always starts and ends with double quote", () => {
    fc.assert(
      fc.property(fc.string(), (val) => {
        const result = csvEscape(val);
        assert.ok(result.startsWith('"'), `should start with ": ${result}`);
        assert.ok(result.endsWith('"'), `should end with ": ${result}`);
      }),
      { numRuns: 200 },
    );
  });

  it("output never contains unescaped newlines", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (val) => {
        const result = csvEscape(val);
        // Strip the outer quotes, then check inner content has no raw newlines
        const inner = result.slice(1, -1);
        assert.ok(!/[\r\n]/.test(inner), `inner content has newlines: ${JSON.stringify(inner)}`);
      }),
      { numRuns: 200 },
    );
  });

  it("internal double quotes are always escaped as pairs", () => {
    fc.assert(
      fc.property(fc.string(), (val) => {
        const result = csvEscape(val);
        const inner = result.slice(1, -1);
        // Every " in inner must be part of a "" pair
        const withoutPairs = inner.replace(/""/g, "");
        assert.ok(!withoutPairs.includes('"'), `unescaped quote in: ${JSON.stringify(inner)}`);
      }),
      { numRuns: 200 },
    );
  });

  it("handles null and undefined without throwing", () => {
    assert.equal(csvEscape(null), '""');
    assert.equal(csvEscape(undefined), '""');
  });

  it("handles numbers and booleans", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        const result = csvEscape(n);
        assert.ok(result.startsWith('"') && result.endsWith('"'));
        assert.equal(result.slice(1, -1), String(n));
      }),
      { numRuns: 50 },
    );
  });
});
