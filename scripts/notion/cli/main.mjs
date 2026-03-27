import { readFile } from "node:fs/promises";
import { NotionActions } from "../actions/NotionActions.mjs";
import { extractPropertyValue } from "../helpers/properties.mjs";
import { ACTIONS, resolveAction, toCamelCase } from "./registry.mjs";

/** Map short/natural flag names to the actual arg/option names used by actions */
const FLAG_ALIASES = {
  source: "sourcePageId",
  src: "sourcePageId",
  parent: "targetParentId",
  target: "targetParentId",
  dest: "targetParentId",
  page: "pageId",
  id: "pageId",
  db: "dbId",
  database: "dbId",
  append: "appendMd",
  prepend: "prependMd",
  content: "content",
  md: "content",
  title: "title",
  name: "title",
  query: "query",
  q: "query",
  filter: "filter",
  sort: "sorts",
  sorts: "sorts",
  depth: "depth",
  after: "after",
};

function parseCliArgs(rawArgs) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a.startsWith("--")) {
      const raw = toCamelCase(a.slice(2));
      const key = FLAG_ALIASES[raw] || raw;
      const next = rawArgs[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

/** CLI output formatters for simple-args mode */
function formatSearchResults(results) {
  return results.map((r) => `  [${r.type}] ${r.title} (${r.id})`).join("\n");
}

function formatWorkspaceMap(data) {
  const lines = [`\u{1F4CA} Workspace: ${data.totalPages} pages, ${data.totalDatabases} databases`];
  for (const p of data.pages.slice(0, 50)) lines.push(`  \u{1F4C4} ${p.title} (${p.id})`);
  for (const d of data.databases.slice(0, 20)) lines.push(`  \u{1F5C3}\uFE0F ${d.title} (${d.id})`);
  return lines.join("\n");
}

function formatDuplicates(groups) {
  return groups.map((g) => `  "${g.title}" \u2014 ${g.count} copies`).join("\n");
}

/** Format queryDatabase entries as a compact markdown table with row IDs */
function formatQueryResults(entries) {
  if (!entries || entries.length === 0) return "_No entries found._";

  const allCols = Object.keys(entries[0].properties);
  const capped = allCols.length > 8;
  const cols = allCols.slice(0, 8);

  const cellValue = (entry, col) => {
    const prop = entry.properties[col];
    if (!prop) return "";
    let v = extractPropertyValue(prop);
    if (typeof v !== "string") v = JSON.stringify(v);
    v = v.replace(/\|/g, "\\|").replace(/\n/g, " ");
    if (v.length > 80) v = `${v.slice(0, 79)}\u2026`;
    return v;
  };

  const header = ["ID", ...cols];
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];

  for (const entry of entries) {
    const id = (entry.id || "").replace(/-/g, "").slice(-4);
    const cells = [id, ...cols.map((c) => cellValue(entry, c))];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push("");
  const footer = `_${entries.length} entries_`;
  if (capped) {
    lines.push(`_\u2026 and ${allCols.length - 8} more columns. Use --format raw for all._`);
  }
  lines.push(footer);
  return lines.join("\n");
}

function printHelp() {
  const desc = {
    search: "Search workspace pages/databases",
    getPage: "Get page content as markdown",
    getDatabase: "Get database schema + all entries",
    queryDatabase: "Query database (markdown table; --format raw for JSON)",
    getTree: "Hierarchical page/database tree",
    exportPage: "Save page as markdown file",
    exportDatabase: "Export as CSV or JSON",
    getComments: "All comments on a page",
    getUsers: "All workspace users",
    createPage: "Create page from markdown",
    updatePage: "Replace all content (auto-snapshots)",
    appendBlocks: "Append markdown to end of page",
    insertBlocks: "Insert blocks at position",
    setProperties: "Update page/entry properties (auto-typed)",
    addComment: "Add comment to page",
    lockPage: "Lock page",
    unlockPage: "Unlock page",
    createDatabase: "Create database with schema",
    addDatabaseEntry: "Add row with auto-typed properties",
    importTable: "Create database from markdown table (infers types)",
    moveBlocks: "Move blocks between pages with rollback",
    movePage: "Move page (deep copy + archive)",
    reorderBlocks: "Reorder blocks by ID array",
    deepCopy: "Full recursive page copy",
    copyPageWith: "Read + modify + create in one call",
    mergePages: "Combine multiple pages into one",
    splitPage: "Split page at headings into subpages",
    extractSection: "Get one section's markdown",
    replaceSection: "Replace section content (auto-snapshots)",
    flattenPage: "Inline subpages into parent",
    nestUnderHeadings: "Convert sections to subpages",
    duplicateStructure: "Copy hierarchy (empty pages)",
    applyTemplate: "Template with {{placeholders}}",
    batchSetProperties: "Update properties on multiple pages",
    batchArchive: "Archive multiple pages",
    batchTag: "Tag pages with select value",
    snapshot: "In-memory snapshot (max 20)",
    restore: "Restore from snapshot",
    backupPage: "Recursive backup to disk",
    backupDatabase: "Export schema + entries to disk",
    transact: "Multi-op with rollback",
    workspaceMap: "All pages and databases",
    pageStats: "Block count, depth, word count",
    diffPages: "Line-level page comparison",
    findDuplicates: "Pages with same title",
    findOrphans: "Root-level pages",
    findEmpty: "Pages with no content",
    findStale: "Pages not edited in N days",
    suggestReorganization: "Structure improvement suggestions",
  };
  const lines = ["Usage: node actions.mjs <action> [args...]\n"];
  for (const [name, spec] of Object.entries(ACTIONS)) {
    const sig = [...spec.args.map((a) => `<${a}>`), ...spec.options.map((o) => `[--${o}]`)].join(" ");
    lines.push(`  ${name.padEnd(24)} ${sig.padEnd(44)} ${desc[name] || ""}`);
  }
  lines.push("");
  lines.push("queryDatabase returns markdown by default. Use --format raw for JSON.");
  lines.push('Stdin: echo \'{"action":"..."}\' | node actions.mjs -');
  console.log(lines.join("\n"));
}

export async function main() {
  const arg = process.argv[2];
  if (!arg || arg === "--help" || arg === "-h" || arg === "help") {
    printHelp();
    process.exit(arg ? 0 : 1);
  }

  const na = new NotionActions();
  let actionName, methodArgs;

  if (arg === "-") {
    // Stdin JSON mode — read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf-8");
    const req = JSON.parse(raw);
    actionName = resolveAction(req.action);

    if (req.contentFile) {
      req.content = await readFile(req.contentFile, "utf-8");
      delete req.contentFile;
    }
    if (req.markdownFile) {
      req.content = await readFile(req.markdownFile, "utf-8");
      delete req.markdownFile;
    }

    const spec = ACTIONS[actionName];
    if (!spec) {
      console.log(
        JSON.stringify(
          { success: false, error: `Unknown action: ${req.action}. Run with --help to see available actions.` },
          null,
          2,
        ),
      );
      process.exit(1);
    }

    const positional = spec.args.map((name) => req[name]);
    const options = {};
    for (const opt of spec.options) {
      if (req[opt] !== undefined) options[opt] = req[opt];
    }
    methodArgs = Object.keys(options).length > 0 ? [...positional, options] : positional;
  } else if (arg.endsWith(".json")) {
    // JSON request file mode
    const raw = await readFile(arg, "utf-8");
    const req = JSON.parse(raw);
    actionName = resolveAction(req.action);

    // Handle contentFile / markdownFile
    if (req.contentFile) {
      req.content = await readFile(req.contentFile, "utf-8");
      delete req.contentFile;
    }
    if (req.markdownFile) {
      req.content = await readFile(req.markdownFile, "utf-8");
      delete req.markdownFile;
    }

    const spec = ACTIONS[actionName];
    if (!spec) {
      console.log(
        JSON.stringify(
          { success: false, error: `Unknown action: ${req.action}. Run with --help to see available actions.` },
          null,
          2,
        ),
      );
      process.exit(1);
    }

    // Check for unknown fields (strict mode)
    const knownFields = new Set(["action", "contentFile", "markdownFile", ...spec.args, ...spec.options]);
    for (const key of Object.keys(req)) {
      if (!knownFields.has(key)) {
        console.log(JSON.stringify({ success: false, error: `Unknown parameter: ${key}` }, null, 2));
        process.exit(1);
      }
    }

    // Map named params to positional args + options
    const positional = spec.args.map((name) => req[name]);
    const options = {};
    for (const opt of spec.options) {
      if (req[opt] !== undefined) options[opt] = req[opt];
    }
    methodArgs = Object.keys(options).length > 0 ? [...positional, options] : positional;
  } else {
    // Simple positional args mode (with --flag support and aliases)
    actionName = resolveAction(arg);
    const spec = ACTIONS[actionName];
    if (!spec) {
      console.error(`Unknown action: ${arg}. Run with --help to see available actions.`);
      process.exit(1);
    }

    const rawArgs = process.argv.slice(3);
    const { positional, flags } = parseCliArgs(rawArgs);

    // Parse positional args (JSON auto-detection)
    const parsedPositional = positional.map((a) => {
      if (a.startsWith("{") || a.startsWith("[")) {
        try {
          return JSON.parse(a);
        } catch {
          return a;
        }
      }
      return a;
    });

    // Merge --flags into options object for the method
    const options = {};
    for (const opt of spec.options) {
      if (flags[opt] !== undefined) {
        const v = flags[opt];
        if (v.startsWith("{") || v.startsWith("[")) {
          try {
            options[opt] = JSON.parse(v);
          } catch {
            options[opt] = v;
          }
        } else {
          options[opt] = v;
        }
      }
    }

    // Also check if any flags match positional arg names that weren't provided positionally
    for (const [i, argName] of spec.args.entries()) {
      if (parsedPositional[i] === undefined && flags[argName] !== undefined) {
        const v = flags[argName];
        if (v.startsWith("{") || v.startsWith("[")) {
          try {
            parsedPositional[i] = JSON.parse(v);
          } catch {
            parsedPositional[i] = v;
          }
        } else {
          parsedPositional[i] = v;
        }
      }
    }

    methodArgs = Object.keys(options).length > 0 ? [...parsedPositional, options] : parsedPositional;
  }

  const method = na[actionName];
  if (!method) {
    console.error(`Method not found: ${actionName}`);
    process.exit(1);
  }

  // Capture CLI-only format option (e.g. --format raw) before dispatch
  const spec = ACTIONS[actionName];
  const cliFormat = spec?.options.includes("format")
    ? methodArgs.find((a) => a && typeof a === "object" && a.format)?.format
    : undefined;

  try {
    const result = await method.call(na, ...methodArgs);

    if (typeof result === "string") {
      console.log(result);
    } else if (!arg.endsWith(".json")) {
      // Simple-args mode: special formatters
      if (actionName === "queryDatabase" && Array.isArray(result) && cliFormat !== "raw") {
        console.log(formatQueryResults(result));
      } else if (actionName === "search") {
        console.log(formatSearchResults(result));
      } else if (actionName === "workspaceMap") {
        console.log(formatWorkspaceMap(result));
      } else if (actionName === "findDuplicates") {
        console.log(formatDuplicates(result));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    } else {
      // JSON file mode: still format queryDatabase as markdown unless raw
      if (actionName === "queryDatabase" && Array.isArray(result) && cliFormat !== "raw") {
        console.log(formatQueryResults(result));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    }

    if (result?.success === false) process.exit(1);
  } catch (e) {
    console.error(e.message || String(e));
    process.exit(1);
  }
}
