#!/usr/bin/env node
// Validates that a benchmark session produced the expected Notion artifacts.
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const ACTIONS = resolve(import.meta.dirname, "../scripts/actions.mjs");
const [marker, scenario] = [process.argv[2], parseInt(process.argv[3], 10)];

if (!marker || Number.isNaN(scenario)) {
  console.error("Usage: node validate-session.mjs <marker> <scenario>");
  process.exit(1);
}

function run(action, ...args) {
  const quoted = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`);
  return execSync(`node ${ACTIONS} ${action} ${quoted.join(" ")}`, {
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

function findPage(marker) {
  const results = run("search", `"[${marker}]"`);
  if (!results.includes(marker)) return null;
  // Extract page ID from search results (first UUID-like match after marker)
  const lines = results.split("\n");
  for (const line of lines) {
    if (line.includes(marker)) {
      const idMatch = line.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
      if (idMatch) return idMatch[1];
      // Also try 32-char hex without dashes
      const hexMatch = line.match(/([a-f0-9]{32})/);
      if (hexMatch) return hexMatch[1];
    }
  }
  return null;
}

function countBulletLines(content) {
  return (content.match(/^[-*]\s/gm) || []).length;
}

function countHeadings(content) {
  return (content.match(/^#{1,3}\s/gm) || []).length;
}

function validate() {
  switch (scenario) {
    case 1: {
      // Summary — page exists with >= 3 bullet points
      const pageId = findPage(marker);
      if (!pageId) return { valid: false, reason: `Page "[${marker}]" not found` };
      const content = run("getPage", pageId);
      const bullets = countBulletLines(content);
      if (bullets < 3) {
        return { valid: false, reason: `Summary has ${bullets} bullet lines (need >= 3)` };
      }
      return { valid: true };
    }
    case 2: {
      // Report — page exists with entry-derived content
      const pageId = findPage(marker);
      if (!pageId) return { valid: false, reason: `Report page not found` };
      const content = run("getPage", pageId);
      const bullets = countBulletLines(content);
      if (bullets < 1) {
        return { valid: false, reason: `Report has no bullet entries` };
      }
      return { valid: true };
    }
    case 3: {
      // Copy — page exists with "Modifications" heading
      const pageId = findPage(marker);
      if (!pageId) return { valid: false, reason: `Page "[${marker}]" not found` };
      const content = run("getPage", pageId);
      if (!/modifications/i.test(content)) {
        return { valid: false, reason: `"Modifications" heading not found in copy` };
      }
      return { valid: true };
    }
    case 4: {
      // setProperties — Benchmark Marker set on entry
      const entryId = process.env.BENCH_ENTRY;
      if (!entryId) return { valid: false, reason: "BENCH_ENTRY not set" };
      const page = run("getPage", entryId);
      if (!page.includes(marker)) {
        return { valid: false, reason: `Benchmark Marker not set to "${marker}"` };
      }
      return { valid: true };
    }
    case 5: {
      // replaceSection — section updated, no duplicated items
      const pageId = process.env.BENCH_PAGE;
      const section = process.env.BENCH_SECTION;
      if (!pageId || !section) return { valid: false, reason: "Missing env" };
      const content = run("extractSection", pageId, section);
      if (!content.includes("Item Alpha")) {
        return { valid: false, reason: "Section content not updated" };
      }
      // Check for duplicated benchmark list items (contamination indicator)
      const alphaCount = (content.match(/Item Alpha/g) || []).length;
      if (alphaCount > 1) {
        return { valid: false, reason: `Duplicated "Item Alpha" (${alphaCount} occurrences) — possible contamination` };
      }
      return { valid: true };
    }
    case 6: {
      // Merge — page exists with >= 3 sections (one per source)
      const pageId = findPage(marker);
      if (!pageId) return { valid: false, reason: `Merged page "[${marker}]" not found` };
      const content = run("getPage", pageId);
      const headings = countHeadings(content);
      if (headings < 3) {
        return { valid: false, reason: `Merged page has ${headings} headings (need >= 3 for 3 sources)` };
      }
      return { valid: true };
    }
    case 7: {
      // batchSetProperties — Benchmark Marker set on all entries
      const entries = (process.env.BENCH_ENTRIES || "").split(",").filter(Boolean);
      if (entries.length === 0) return { valid: false, reason: "BENCH_ENTRIES not set" };
      for (const entryId of entries) {
        const page = run("getPage", entryId.trim());
        if (!page.includes(marker)) {
          return { valid: false, reason: `Entry ${entryId.trim()} Benchmark Marker not set to "${marker}"` };
        }
      }
      return { valid: true };
    }
    case 8: {
      // Modified Copy — page exists with "Benchmark Notes" section
      const pageId = findPage(marker);
      if (!pageId) return { valid: false, reason: `Modified copy "[${marker}]" not found` };
      const content = run("getPage", pageId);
      if (!/benchmark\s*notes/i.test(content)) {
        return { valid: false, reason: `"Benchmark Notes" section not found in copy` };
      }
      return { valid: true };
    }
    default:
      return { valid: true };
  }
}

const result = validate();
console.log(JSON.stringify(result));
process.exit(result.valid ? 0 : 1);
