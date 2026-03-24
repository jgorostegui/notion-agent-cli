#!/usr/bin/env node
// Archives benchmark-created pages and databases under BENCH_PARENT.
// Usage: node cleanup-artifacts.mjs [run-id]
// If run-id is provided, only archives artifacts containing that run-id in the title.
// If omitted, archives ALL benchmark artifacts (titles containing "[" marker pattern).
import { NotionActions } from "../scripts/actions.mjs";

const runId = process.argv[2];
const parentId = process.env.BENCH_PARENT;

if (!parentId) {
  console.error("BENCH_PARENT not set");
  process.exit(1);
}

try {
  const actions = new NotionActions();

  // Fetch shallow blocks to find child_page and child_database entries
  const blocks = await actions._fetchBlocksShallow(parentId);

  const pageIds = [];
  const dbIds = [];

  for (const block of blocks) {
    if (block.type === "child_page") {
      const title = block.child_page?.title || "";
      if (!title.includes("[")) continue;
      if (runId && !title.includes(runId)) continue;
      pageIds.push(block.id);
    } else if (block.type === "child_database") {
      const title = block.child_database?.title || "";
      if (!title.includes("[")) continue;
      if (runId && !title.includes(runId)) continue;
      dbIds.push(block.id);
    }
  }

  const total = pageIds.length + dbIds.length;
  if (total === 0) {
    console.log("No benchmark artifacts to clean up.");
    process.exit(0);
  }

  console.log(`Found ${pageIds.length} pages and ${dbIds.length} databases to archive.`);

  // Archive pages
  if (pageIds.length > 0) {
    const result = await actions.batchArchive(pageIds);
    console.log(`Archived ${result.archived} pages.`);
    if (result.errors?.length > 0) {
      for (const err of result.errors) {
        console.warn(`  WARNING: ${err.id}: ${err.error}`);
      }
    }
  }

  // Archive databases (use pages.update with archived: true)
  let dbArchived = 0;
  for (const dbId of dbIds) {
    try {
      await actions._call(() => actions.client.databases.update({ database_id: dbId, in_trash: true }));
      dbArchived++;
    } catch (e) {
      console.warn(`  WARNING: database ${dbId}: ${e.message}`);
    }
  }
  if (dbIds.length > 0) {
    console.log(`Archived ${dbArchived} databases.`);
  }

  console.log("Cleanup complete.");
} catch (e) {
  console.error(`Cleanup failed: ${e.message}`);
  process.exit(1);
}
