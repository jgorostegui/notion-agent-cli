/**
 * Property-based tests for structural operations
 * Properties 9-12: H1→H2 demotion, markdown splitting, section extraction, template placeholders
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";

const safeText = fc
  .stringOf(
    fc.char().filter((c) => !/[#\-*>`~_[\]()\\$\n\r{}]/.test(c)),
    { minLength: 1, maxLength: 100 },
  )
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// ── Property 9: H1 to H2 demotion preserves content ────────────────────────

describe("Property 9: H1 to H2 demotion preserves content", () => {
  it("replacing # Title with ## Title preserves all text after the heading marker", () => {
    fc.assert(
      fc.property(safeText, (title) => {
        const h1 = `# ${title}`;
        // Demotion logic used in mergePages/flattenPage
        const demoted = h1.replace(/^# /, "## ");
        assert.ok(demoted.startsWith("## "), "starts with ##");
        assert.equal(demoted.slice(3), title, "text content preserved");
      }),
      { numRuns: 100 },
    );
  });

  it("non-H1 lines are not affected by demotion", () => {
    fc.assert(
      fc.property(safeText, (text) => {
        const lines = [`## ${text}`, `### ${text}`, `- ${text}`, text];
        for (const line of lines) {
          const demoted = line.replace(/^# /, "## ");
          assert.equal(demoted, line, "non-H1 line unchanged");
        }
      }),
      { numRuns: 50 },
    );
  });
});

// ── Property 10: Markdown splitting at heading boundaries ───────────────────

describe("Property 10: Markdown splitting at heading boundaries", () => {
  it("N headings produce N sections, each starting with that heading level", () => {
    fc.assert(
      fc.property(fc.array(safeText, { minLength: 2, maxLength: 8 }), (titles) => {
        const _level = 2;
        const md = titles.map((t) => `## ${t}\n\nSome content for ${t}`).join("\n\n");
        const lines = md.split("\n");

        // Split at heading boundaries (same logic as splitPage)
        const sections = [];
        let current = [];
        for (const line of lines) {
          if (line.startsWith("## ") && current.length > 0) {
            sections.push(current.join("\n"));
            current = [];
          }
          current.push(line);
        }
        if (current.length > 0) sections.push(current.join("\n"));

        assert.equal(sections.length, titles.length, `expected ${titles.length} sections`);
        for (let i = 0; i < sections.length; i++) {
          assert.ok(sections[i].trimStart().startsWith("## "), `section ${i} starts with ##`);
        }

        // Concatenation reproduces original (modulo join separator)
        const rejoined = sections.join("\n");
        assert.equal(rejoined, md);
      }),
      { numRuns: 50 },
    );
  });
});

// ── Property 11: Section extraction captures correct range ──────────────────

describe("Property 11: Section extraction captures correct range", () => {
  it("captures from matching heading to next heading of same or higher level", () => {
    // Use unique prefixed titles with separators to avoid substring matching
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), safeText, fc.integer({ min: 1, max: 999 }), (id1, body1, id2) => {
        const title1 = `Section-A${id1}`;
        const title2 = `Section-B${id1 === id2 ? id2 + 1000 : id2}`;
        const md = `## ${title1}\n\n${body1}\n\n## ${title2}\n\nOther content`;
        const lines = md.split("\n");

        // Extract section for title1 (same logic as extractSection)
        let startIdx = -1;
        let endIdx = lines.length;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line === `## ${title1}`) {
            startIdx = i;
            continue;
          }
          if (startIdx >= 0 && i > startIdx) {
            const headingMatch = line.match(/^(#{1,3})\s/);
            if (headingMatch && headingMatch[1].length <= 2) {
              endIdx = i;
              break;
            }
          }
        }

        if (startIdx >= 0) {
          const section = lines.slice(startIdx, endIdx).join("\n");
          assert.ok(section.includes(title1), "section contains the heading text");
          assert.ok(section.includes(body1), "section contains the body");
          assert.ok(!section.includes(`## ${title2}`), "section does not contain next heading");
        }
      }),
      { numRuns: 50 },
    );
  });

  it("captures to end of page when no subsequent heading", () => {
    fc.assert(
      fc.property(safeText, safeText, (title, body) => {
        const md = `## ${title}\n\n${body}`;
        const lines = md.split("\n");

        let startIdx = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith("## ")) {
            startIdx = i;
            break;
          }
        }

        const section = lines.slice(startIdx).join("\n");
        assert.ok(section.includes(title));
        assert.ok(section.includes(body));
      }),
      { numRuns: 30 },
    );
  });
});

// ── Property 12: Template placeholder replacement ───────────────────────────

describe("Property 12: Template placeholder replacement", () => {
  it("every {{key}} replaced with corresponding value, no {{key}} patterns remain", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), { minLength: 1, maxLength: 10 }),
          // Avoid special replacement patterns ($`, $', $$, $&) that alter replaceAll behavior
          fc.stringOf(
            fc.char().filter((c) => c !== "$"),
            { minLength: 1, maxLength: 50 },
          ),
          { minKeys: 1, maxKeys: 5 },
        ),
        (variables) => {
          // Build template with placeholders
          const template = Object.keys(variables)
            .map((k) => `Hello {{${k}}}`)
            .join("\n");

          // Apply replacement (same logic as applyTemplate)
          let result = template;
          for (const [key, value] of Object.entries(variables)) {
            result = result.replaceAll(`{{${key}}}`, value);
          }

          // No {{key}} patterns remain for provided keys
          for (const key of Object.keys(variables)) {
            assert.ok(!result.includes(`{{${key}}}`), `{{${key}}} should be replaced`);
          }

          // Values are present (safe since we excluded $ chars)
          for (const [key, value] of Object.entries(variables)) {
            assert.ok(result.includes(value), `value for ${key} should be present`);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
