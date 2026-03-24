#!/usr/bin/env node
// Validates that a benchmark session produced the expected Notion artifacts.
// Runs immediately after each session, before fixture reset.
// Uses NotionActions directly (no CLI subprocesses) to avoid timeout issues.
import { extractPropertyValue, NotionActions } from "../scripts/actions.mjs";

const [marker, scenario] = [process.argv[2], parseInt(process.argv[3], 10)];

if (!marker || Number.isNaN(scenario)) {
  console.error("Usage: node validate-session.mjs <marker> <scenario>");
  process.exit(1);
}

const actions = new NotionActions();

/** Find a page under BENCH_PARENT by scanning shallow blocks.
 *  No recursion, just lists child_page/child_database entries. */
async function findPage(marker) {
  const parentId = process.env.BENCH_PARENT;
  if (!parentId) return null;
  const blocks = await actions._fetchBlocksShallow(parentId);
  const match = blocks.find((b) => b.type === "child_page" && b.child_page?.title?.includes(marker));
  return match?.id || null;
}

/** Find a database under BENCH_PARENT by scanning shallow blocks. */
async function findDatabase(marker) {
  const parentId = process.env.BENCH_PARENT;
  if (!parentId) return null;
  const blocks = await actions._fetchBlocksShallow(parentId);
  const match = blocks.find((b) => b.type === "child_database" && b.child_database?.title?.includes(marker));
  return match?.id || null;
}

/** Read a property value from a database entry. */
async function readEntryProperty(dbId, entryId, propertyName) {
  const dsId = await actions._resolveDataSourceId(dbId);
  const entries = await actions._paginateQuery(dsId);
  const normalized = entryId.replace(/-/g, "");
  const entry = entries.find((e) => e.id === entryId || e.id.replace(/-/g, "") === normalized);
  if (!entry) return null;
  const prop = entry.properties?.[propertyName];
  if (!prop) return null;
  return extractPropertyValue(prop);
}

function countBulletLines(content) {
  return (content.match(/^[-*]\s/gm) || []).length;
}

function countHeadings(content) {
  return (content.match(/^#{1,3}\s/gm) || []).length;
}

async function validate() {
  switch (scenario) {
    case 1: {
      const pageId = await findPage(marker);
      if (!pageId) return { valid: false, reason: `Page "[${marker}]" not found under BENCH_PARENT` };
      const content = await actions.getPage(pageId);
      const bullets = countBulletLines(content);
      if (bullets < 3) {
        return { valid: false, reason: `Summary has ${bullets} bullet lines (need >= 3)` };
      }
      return { valid: true };
    }
    case 2: {
      const pageId = await findPage(marker);
      if (!pageId) return { valid: false, reason: `Report page not found under BENCH_PARENT` };
      const content = await actions.getPage(pageId);
      const bullets = countBulletLines(content);
      if (bullets < 1) {
        return { valid: false, reason: `Report has no bullet entries` };
      }
      return { valid: true };
    }
    case 3: {
      const pageId = await findPage(marker);
      if (!pageId) return { valid: false, reason: `Page "[${marker}]" not found under BENCH_PARENT` };
      const content = await actions.getPage(pageId);
      if (!/modifications/i.test(content)) {
        return { valid: false, reason: `"Modifications" heading not found in copy` };
      }
      return { valid: true };
    }
    case 4: {
      const entryId = process.env.BENCH_ENTRY;
      const dbId = process.env.BENCH_DB;
      if (!entryId || !dbId) return { valid: false, reason: "BENCH_ENTRY or BENCH_DB not set" };
      const value = await readEntryProperty(dbId, entryId, "Benchmark Marker");
      if (value === null) {
        return { valid: false, reason: "Could not read Benchmark Marker property" };
      }
      if (!value.includes(marker)) {
        return { valid: false, reason: `Benchmark Marker is "${value}", expected "${marker}"` };
      }
      return { valid: true };
    }
    case 5: {
      const pageId = process.env.BENCH_PAGE;
      const section = process.env.BENCH_SECTION;
      if (!pageId || !section) return { valid: false, reason: "Missing env" };
      const result = await actions.extractSection(pageId, section);
      const content = result.markdown || "";
      if (!content.includes("Item Alpha")) {
        return { valid: false, reason: "Section content not updated" };
      }
      const alphaCount = (content.match(/Item Alpha/g) || []).length;
      if (alphaCount > 1) {
        return { valid: false, reason: `Duplicated "Item Alpha" (${alphaCount} occurrences)` };
      }
      return { valid: true };
    }
    case 6: {
      const pageId = await findPage(marker);
      if (!pageId) return { valid: false, reason: `Merged page "[${marker}]" not found under BENCH_PARENT` };
      const content = await actions.getPage(pageId);
      const headings = countHeadings(content);
      if (headings < 3) {
        return { valid: false, reason: `Merged page has ${headings} headings (need >= 3 for 3 sources)` };
      }
      return { valid: true };
    }
    case 7: {
      const entries = (process.env.BENCH_ENTRIES || "").split(",").filter(Boolean);
      const dbId = process.env.BENCH_DB;
      if (entries.length === 0 || !dbId) return { valid: false, reason: "BENCH_ENTRIES or BENCH_DB not set" };
      for (const entryId of entries) {
        const value = await readEntryProperty(dbId, entryId.trim(), "Benchmark Marker");
        if (value === null) {
          return { valid: false, reason: `Could not read Benchmark Marker on entry ${entryId.trim()}` };
        }
        if (!value.includes(marker)) {
          return {
            valid: false,
            reason: `Entry ${entryId.trim()} Benchmark Marker is "${value}", expected "${marker}"`,
          };
        }
      }
      return { valid: true };
    }
    case 8: {
      const pageId = await findPage(marker);
      if (!pageId) return { valid: false, reason: `Modified copy "[${marker}]" not found under BENCH_PARENT` };
      const content = await actions.getPage(pageId);
      if (!/benchmark\s*notes/i.test(content)) {
        return { valid: false, reason: `"Benchmark Notes" section not found in copy` };
      }
      return { valid: true };
    }
    case 9: {
      const pageId = await findPage(marker);
      if (!pageId) return { valid: false, reason: `Table page "[${marker}]" not found under BENCH_PARENT` };
      const content = await actions.getPage(pageId);

      const tableRows = content.match(/^\|.+\|$/gm) || [];
      if (tableRows.length === 0) {
        return { valid: false, reason: "Page has no table (no pipe-delimited rows)" };
      }

      const dataRows = tableRows.filter((r) => !/^\|[\s:-]+\|$/.test(r));
      if (dataRows.length < 25) {
        return { valid: false, reason: `Table has ${dataRows.length} rows (expected >= 25 of 31)` };
      }

      const cols = dataRows[0].split("|").filter((c) => c.trim() !== "").length;
      if (cols < 5) {
        return { valid: false, reason: `Table has ${cols} columns (expected 5)` };
      }

      const expectedHeaders = ["Film", "Director", "Year", "Genre", "Rating"];
      const headerRow = dataRows[0].toLowerCase();
      const missingHeaders = expectedHeaders.filter((h) => !headerRow.includes(h.toLowerCase()));
      if (missingHeaders.length > 0) {
        return { valid: false, reason: `Missing headers: ${missingHeaders.join(", ")}` };
      }

      const spotChecks = ["Spirited Away", "Diving Bell"];
      const missingSpots = spotChecks.filter((s) => !content.includes(s));
      if (missingSpots.length > 0) {
        return { valid: false, reason: `Spot-check failed, missing: ${missingSpots.join(", ")}` };
      }

      return { valid: true, details: { rows: dataRows.length, columns: cols } };
    }
    case 10: {
      const errors = [];

      const dbId = await findDatabase(marker);
      if (!dbId) {
        return { valid: false, reason: `Database "DB [${marker}]" not found under BENCH_PARENT` };
      }

      let entries;
      try {
        const dsId = await actions._resolveDataSourceId(dbId);
        entries = await actions._paginateQuery(dsId);
      } catch (e) {
        return { valid: false, reason: `Failed to query database: ${e.message}` };
      }

      const entryCount = entries.length;
      if (entryCount < 25) {
        errors.push(`Only ${entryCount} entries (expected >= 25 of 30)`);
      }

      // Check titles are populated
      const titles = entries.map((e) => {
        for (const prop of Object.values(e.properties || {})) {
          if (prop.type === "title") return extractPropertyValue(prop);
        }
        return "Untitled";
      });
      const untitledCount = titles.filter((t) => t === "Untitled" || t === "").length;
      if (untitledCount > 3) {
        errors.push(`${untitledCount} "Untitled" entries — title column likely not populated`);
      }

      // Spot-check film names
      const allTitles = titles.join(" ");
      const spotChecks = ["Spirited Away", "Parasite", "Oldboy"];
      const missingFilms = spotChecks.filter((f) => !allTitles.includes(f));
      if (missingFilms.length > 0) {
        errors.push(`Missing films: ${missingFilms.join(", ")}`);
      }

      // Check numeric and select values via extractPropertyValue
      const allValues = entries
        .flatMap((e) => Object.values(e.properties || {}).map((p) => extractPropertyValue(p)))
        .join(" ");

      if (!allValues.includes("2001") && !allValues.includes("2019")) {
        errors.push("Year values not found");
      }
      if (!allValues.includes("8.6") && !allValues.includes("8.5")) {
        errors.push("Rating values not found");
      }
      if (!allValues.includes("Drama") && !allValues.includes("Animation")) {
        errors.push("Genre values not found");
      }

      if (errors.length > 0) {
        return { valid: false, reason: errors.join("; ") };
      }

      return { valid: true, details: { databaseId: dbId, entryCount } };
    }
    default:
      return { valid: true };
  }
}

const result = await validate();
console.log(JSON.stringify(result));
process.exit(result.valid ? 0 : 1);
