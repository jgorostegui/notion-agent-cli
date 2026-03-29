#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NotionActions } from "../scripts/actions.mjs";

const CANONICAL_SECTION = resolve(import.meta.dirname, "fixtures/canonical-section.md");

const actions = new NotionActions();

const { BENCH_DB, BENCH_ENTRY, BENCH_ENTRIES, BENCH_PAGE, BENCH_SECTION, BENCH_MERGE_SOURCES } = process.env;

// 1. Clear Benchmark Marker on BENCH_ENTRY
if (BENCH_ENTRY) {
  try {
    await actions.setProperties(BENCH_ENTRY, { "Benchmark Marker": "" });
    console.log("Cleared Benchmark Marker on BENCH_ENTRY");
  } catch (e) {
    console.warn(`WARNING: Failed to clear Benchmark Marker on BENCH_ENTRY: ${e.message}`);
  }
}

// 2. Clear Benchmark Marker on all BENCH_ENTRIES (S7)
if (BENCH_ENTRIES) {
  const entries = BENCH_ENTRIES.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const entryId of entries) {
    try {
      await actions.setProperties(entryId, { "Benchmark Marker": "" });
      console.log(`Cleared Benchmark Marker on ${entryId}`);
    } catch (e) {
      console.warn(`WARNING: Failed to clear Benchmark Marker on ${entryId}: ${e.message}`);
    }
  }
}

// 3. Restore S5 section from canonical file
if (BENCH_PAGE && BENCH_SECTION) {
  try {
    const canonical = readFileSync(CANONICAL_SECTION, "utf-8").trim();
    await actions.replaceSection(BENCH_PAGE, BENCH_SECTION, canonical);
    console.log(`Restored section "${BENCH_SECTION}" from canonical file`);
  } catch (e) {
    console.warn(`WARNING: Failed to restore section "${BENCH_SECTION}": ${e.message}`);
  }
}

// 4. Verify S6 merge sources exist and are not archived
if (BENCH_MERGE_SOURCES) {
  const sources = BENCH_MERGE_SOURCES.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const srcId of sources) {
    try {
      const page = await actions.getPage(srcId);
      if (page.includes("archived") || page.includes("not found")) {
        console.error(`ERROR: Merge source ${srcId} is archived or missing`);
        process.exit(1);
      }
      console.log(`Verified merge source ${srcId}`);
    } catch (e) {
      console.warn(`WARNING: Merge source ${srcId} inaccessible (may be transient): ${e.message}`);
    }
  }
}

// 5. Legacy warning: Bench-* status option accumulation
if (BENCH_DB) {
  try {
    const dbInfo = await actions.getDatabase(BENCH_DB);
    const benchCount = (dbInfo.match(/Bench-/g) || []).length;
    if (benchCount > 10) {
      console.warn(`WARNING: ${benchCount} legacy Bench-* status options accumulated.`);
      console.warn("Consider fresh fixture DB. Notion API cannot delete select options.");
    }
  } catch {
    // Non-critical
  }
}

console.log("Fixture reset complete.");
