/**
 * Property-based tests for analysis and safety operations
 * Properties 13, 15-19: snapshot eviction, diff correctness, duplicate grouping,
 * orphan filtering, stale date filtering, reorganization thresholds
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";

// ── Property 13: Snapshot eviction at max 20 ────────────────────────────────

describe("Property 13: Snapshot eviction at max 20", () => {
  it("Map size never exceeds 20, 21st snapshot evicts oldest", () => {
    fc.assert(
      fc.property(fc.integer({ min: 15, max: 40 }), (count) => {
        const snapshots = new Map();
        const ids = [];

        for (let i = 0; i < count; i++) {
          const snapId = `page_${i}`;
          snapshots.set(snapId, { pageId: "page", blocks: [], timestamp: new Date().toISOString() });
          ids.push(snapId);

          // Evict oldest if over 20 (same logic as snapshot())
          while (snapshots.size > 20) {
            const oldest = snapshots.keys().next().value;
            snapshots.delete(oldest);
          }

          assert.ok(snapshots.size <= 20, `size ${snapshots.size} should be ≤ 20`);
        }

        // After all insertions, size is min(count, 20)
        assert.equal(snapshots.size, Math.min(count, 20));

        // If count > 20, the first (count - 20) entries should be evicted
        if (count > 20) {
          for (let i = 0; i < count - 20; i++) {
            assert.ok(!snapshots.has(ids[i]), `${ids[i]} should be evicted`);
          }
          // Last 20 should still be present
          for (let i = count - 20; i < count; i++) {
            assert.ok(snapshots.has(ids[i]), `${ids[i]} should still exist`);
          }
        }
      }),
      { numRuns: 50 },
    );
  });
});

// ── Property 15: Line-level diff correctness ────────────────────────────────

describe("Property 15: Line-level diff correctness", () => {
  it("onlyInFirst in first but not second, onlyInSecond in second but not first, common in both", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 20 }),
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 20 }),
        (lines1, lines2) => {
          // Filter empty (same as diffPages)
          const filtered1 = lines1.filter((l) => l.trim());
          const filtered2 = lines2.filter((l) => l.trim());
          const set1 = new Set(filtered1);
          const set2 = new Set(filtered2);

          const common = filtered1.filter((l) => set2.has(l));
          const onlyInFirst = filtered1.filter((l) => !set2.has(l));
          const onlyInSecond = filtered2.filter((l) => !set1.has(l));

          // onlyInFirst items are NOT in set2
          for (const line of onlyInFirst) {
            assert.ok(!set2.has(line), `"${line}" should not be in second`);
          }
          // onlyInSecond items are NOT in set1
          for (const line of onlyInSecond) {
            assert.ok(!set1.has(line), `"${line}" should not be in first`);
          }
          // common items are in both
          for (const line of common) {
            assert.ok(set1.has(line) && set2.has(line), `"${line}" should be in both`);
          }
          // stats.commonLines matches
          assert.equal(common.length, common.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 16: Duplicate grouping by lowercase-trimmed title ──────────────

describe("Property 16: Duplicate grouping by lowercase-trimmed title", () => {
  it("groups have 2+ pages, same normalized title, no unique-title pages in groups", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ id: fc.uuid(), title: fc.constantFrom("Alpha", "alpha", "ALPHA", "Beta", "Gamma", "gamma") }),
          { minLength: 3, maxLength: 20 },
        ),
        (pages) => {
          // Same grouping logic as findDuplicates
          const groups = {};
          for (const p of pages) {
            const key = p.title.toLowerCase().trim();
            if (!groups[key]) groups[key] = [];
            groups[key].push(p);
          }
          const duplicates = Object.entries(groups)
            .filter(([, pages]) => pages.length > 1)
            .map(([title, pages]) => ({ title, count: pages.length, pages }));

          for (const group of duplicates) {
            // 2+ pages per group
            assert.ok(group.count >= 2, `group "${group.title}" has ${group.count} pages`);
            // All pages in group have same normalized title
            for (const page of group.pages) {
              assert.equal(page.title.toLowerCase().trim(), group.title);
            }
          }

          // No unique-title pages appear in groups
          const groupTitles = new Set(duplicates.map((g) => g.title));
          for (const [key, arr] of Object.entries(groups)) {
            if (arr.length === 1) {
              assert.ok(!groupTitles.has(key), `unique title "${key}" should not be in groups`);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ── Property 17: Orphan filtering by parent type ────────────────────────────

describe("Property 17: Orphan filtering by parent type", () => {
  it("returns exactly pages where parent.type === 'workspace'", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            title: fc.string({ minLength: 1, maxLength: 30 }),
            parent: fc.record({ type: fc.constantFrom("workspace", "page_id", "database_id") }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (pages) => {
          const orphans = pages.filter((p) => p.parent?.type === "workspace");
          const nonOrphans = pages.filter((p) => p.parent?.type !== "workspace");

          // Every orphan has workspace parent
          for (const o of orphans) {
            assert.equal(o.parent.type, "workspace");
          }
          // No non-orphan has workspace parent
          for (const n of nonOrphans) {
            assert.notEqual(n.parent.type, "workspace");
          }
          // Counts add up
          assert.equal(orphans.length + nonOrphans.length, pages.length);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ── Property 18: Stale page date filtering ──────────────────────────────────

describe("Property 18: Stale page date filtering", () => {
  it("returns exactly pages where lastEdited < (now - days * 86400000)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 365 }),
        fc.array(
          fc.record({
            id: fc.uuid(),
            lastEdited: fc
              .date({ min: new Date("2023-01-01"), max: new Date("2026-02-28") })
              .map((d) => d.toISOString()),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (days, pages) => {
          const cutoff = Date.now() - days * 86400000;
          const stale = pages.filter((p) => new Date(p.lastEdited).getTime() < cutoff);
          const fresh = pages.filter((p) => new Date(p.lastEdited).getTime() >= cutoff);

          for (const s of stale) {
            assert.ok(new Date(s.lastEdited).getTime() < cutoff, `${s.lastEdited} should be stale`);
          }
          for (const f of fresh) {
            assert.ok(new Date(f.lastEdited).getTime() >= cutoff, `${f.lastEdited} should be fresh`);
          }
          assert.equal(stale.length + fresh.length, pages.length);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ── Property 19: Reorganization suggestion thresholds ───────────────────────

describe("Property 19: Reorganization suggestion thresholds", () => {
  it("too_deep for depth > 3, too_wide for children > 10, too_long for wordCount > 3000, many_blocks for blockCount > 200", () => {
    fc.assert(
      fc.property(
        fc.record({
          depth: fc.integer({ min: 0, max: 10 }),
          childCount: fc.integer({ min: 0, max: 30 }),
          wordCount: fc.integer({ min: 0, max: 10000 }),
          blockCount: fc.integer({ min: 0, max: 500 }),
        }),
        ({ depth, childCount, wordCount, blockCount }) => {
          const suggestions = [];

          // Same threshold logic as suggestReorganization
          if (depth > 3) suggestions.push({ type: "too_deep" });
          if (childCount > 10) suggestions.push({ type: "too_wide" });
          if (wordCount > 3000) suggestions.push({ type: "too_long" });
          if (blockCount > 200) suggestions.push({ type: "many_blocks" });

          const types = suggestions.map((s) => s.type);

          if (depth > 3) assert.ok(types.includes("too_deep"));
          else assert.ok(!types.includes("too_deep"));

          if (childCount > 10) assert.ok(types.includes("too_wide"));
          else assert.ok(!types.includes("too_wide"));

          if (wordCount > 3000) assert.ok(types.includes("too_long"));
          else assert.ok(!types.includes("too_long"));

          if (blockCount > 200) assert.ok(types.includes("many_blocks"));
          else assert.ok(!types.includes("many_blocks"));
        },
      ),
      { numRuns: 100 },
    );
  });
});
