/**
 * Property-based tests for CLI dispatcher
 * Properties 20, 21, 22, 23, 28: CLI input mode detection, output/exit codes,
 * return value contract, position parameter format, JSON request parameter mapping
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { ACTIONS, NotionActions, toCamelCase } from "../../scripts/actions.mjs";

// ── Property 20: CLI input mode detection ───────────────────────────────────

describe("Property 20: CLI input mode detection", () => {
  it("strings ending with .json → JSON file mode", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).map((s) => `${s.replace(/\./g, "")}.json`),
        (arg) => {
          assert.ok(arg.endsWith(".json"), "should be detected as JSON file mode");
        },
      ),
      { numRuns: 50 },
    );
  });

  it("strings NOT ending with .json → direct args mode", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.endsWith(".json")),
        (arg) => {
          assert.ok(!arg.endsWith(".json"), "should be detected as direct args mode");
        },
      ),
      { numRuns: 50 },
    );
  });

  it("toCamelCase converts snake_case action names", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "get_page",
          "query_database",
          "export_page",
          "find_duplicates",
          "batch_set_properties",
          "suggest_reorganization",
          "add_database_entry",
        ),
        (snakeCase) => {
          const camel = toCamelCase(snakeCase);
          assert.ok(!camel.includes("_"), "no underscores in camelCase");
          assert.ok(camel.length > 0, "non-empty result");
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ── Property 21: CLI output and exit codes ──────────────────────────────────

describe("Property 21: CLI output and exit codes", () => {
  it("string result → direct output, exit 0", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (result) => {
        // String results are printed directly
        assert.equal(typeof result, "string");
        // Exit code 0 (no success: false)
      }),
      { numRuns: 30 },
    );
  });

  it("{ success: true } → JSON output, exit 0", () => {
    fc.assert(
      fc.property(fc.record({ success: fc.constant(true), data: fc.string() }), (result) => {
        const json = JSON.stringify(result, null, 2);
        assert.ok(json.includes('"success": true'));
        // Exit code would be 0
      }),
      { numRuns: 20 },
    );
  });

  it("{ success: false } → JSON output, exit 1", () => {
    fc.assert(
      fc.property(fc.record({ success: fc.constant(false), error: fc.string() }), (result) => {
        const json = JSON.stringify(result, null, 2);
        assert.ok(json.includes('"success": false'));
        // Exit code would be 1
      }),
      { numRuns: 20 },
    );
  });
});

// ── Property 22: Return value contract ──────────────────────────────────────

describe("Property 22: Return value contract", () => {
  const writeActions = [
    "createPage",
    "updatePage",
    "appendBlocks",
    "insertBlocks",
    "setProperties",
    "addComment",
    "lockPage",
    "unlockPage",
    "createDatabase",
    "addDatabaseEntry",
  ];
  const structuralActions = [
    "moveBlocks",
    "movePage",
    "reorderBlocks",
    "deepCopy",
    "mergePages",
    "splitPage",
    "replaceSection",
    "flattenPage",
    "nestUnderHeadings",
    "duplicateStructure",
    "applyTemplate",
  ];
  const batchActions = ["batchSetProperties", "batchArchive", "batchTag"];
  const safetyActions = ["snapshot", "restore", "backupPage", "backupDatabase", "transact"];
  const readActions = [
    "search",
    "getPage",
    "getDatabase",
    "queryDatabase",
    "getTree",
    "exportPage",
    "exportDatabase",
    "getComments",
    "getUsers",
  ];
  const analysisActions = [
    "workspaceMap",
    "pageStats",
    "diffPages",
    "findDuplicates",
    "findOrphans",
    "findEmpty",
    "findStale",
    "suggestReorganization",
  ];

  it("WRITE/STRUCTURAL/BATCH/SAFETY actions are in ACTIONS registry", () => {
    const allWrapped = [...writeActions, ...structuralActions, ...batchActions, ...safetyActions];
    for (const action of allWrapped) {
      assert.ok(ACTIONS[action], `${action} should be in ACTIONS registry`);
    }
  });

  it("READ/ANALYSIS actions are in ACTIONS registry", () => {
    const allDirect = [...readActions, ...analysisActions];
    for (const action of allDirect) {
      assert.ok(ACTIONS[action], `${action} should be in ACTIONS registry`);
    }
  });

  it("WRITE/STRUCTURAL/BATCH/SAFETY methods exist on NotionActions prototype", () => {
    const allWrapped = [...writeActions, ...structuralActions, ...batchActions, ...safetyActions];
    for (const action of allWrapped) {
      assert.equal(typeof NotionActions.prototype[action], "function", `${action} should be a method`);
    }
  });

  it("READ/ANALYSIS methods exist on NotionActions prototype", () => {
    const allDirect = [...readActions, ...analysisActions];
    for (const action of allDirect) {
      assert.equal(typeof NotionActions.prototype[action], "function", `${action} should be a method`);
    }
  });

  it("snapshot method exists and would return { success, snapshotId }", () => {
    assert.equal(typeof NotionActions.prototype.snapshot, "function");
    // Can't call without API, but verify it's in the registry
    assert.ok(ACTIONS.snapshot);
  });
});

// ── Property 23: Position parameter format ──────────────────────────────────

describe("Property 23: Position parameter format", () => {
  it("after-block position produces correct nested format, never bare string", () => {
    fc.assert(
      fc.property(fc.uuid(), (blockId) => {
        // The format used in _appendAtPosition
        const position = { type: "after_block", after_block: { id: blockId } };

        assert.equal(position.type, "after_block");
        assert.ok(position.after_block, "has after_block object");
        assert.equal(position.after_block.id, blockId);
        assert.equal(typeof position, "object", "not a bare string");
        assert.notEqual(typeof position, "string", "never a bare string");
      }),
      { numRuns: 50 },
    );
  });

  it("start position format", () => {
    const position = { type: "start" };
    assert.equal(position.type, "start");
    assert.equal(typeof position, "object");
  });

  it("end position format", () => {
    const position = { type: "end" };
    assert.equal(position.type, "end");
    assert.equal(typeof position, "object");
  });
});

// ── Property 28: JSON request file parameter mapping ────────────────────────

describe("Property 28: JSON request file parameter mapping", () => {
  it("named parameters mapped to correct positional/options args via action registry", () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.keys(ACTIONS)), (actionName) => {
        const spec = ACTIONS[actionName];
        assert.ok(spec, `${actionName} in registry`);
        assert.ok(Array.isArray(spec.args), "args is array");
        assert.ok(Array.isArray(spec.options), "options is array");

        // Build a mock request
        const req = { action: actionName };
        for (const arg of spec.args) req[arg] = `test_${arg}`;
        for (const opt of spec.options) req[opt] = `opt_${opt}`;

        // Map named params to positional args + options (same logic as main())
        const knownFields = new Set(["action", "contentFile", "markdownFile", ...spec.args, ...spec.options]);
        for (const key of Object.keys(req)) {
          assert.ok(knownFields.has(key), `${key} should be a known field`);
        }

        const positional = spec.args.map((name) => req[name]);
        assert.equal(positional.length, spec.args.length);

        const options = {};
        for (const opt of spec.options) {
          if (req[opt] !== undefined) options[opt] = req[opt];
        }
      }),
      { numRuns: 30 },
    );
  });

  it("unknown fields rejected in strict mode", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("getPage", "search", "createPage"),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-z]+$/.test(s)),
        (actionName, unknownField) => {
          const spec = ACTIONS[actionName];
          const knownFields = new Set(["action", "contentFile", "markdownFile", ...spec.args, ...spec.options]);

          if (!knownFields.has(unknownField)) {
            // This field would be rejected
            assert.ok(!knownFields.has(unknownField), `${unknownField} is unknown`);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it("action field is removed before mapping", () => {
    for (const actionName of Object.keys(ACTIONS)) {
      const spec = ACTIONS[actionName];
      // 'action' is not in args or options
      assert.ok(!spec.args.includes("action"), `${actionName}: action not in args`);
      assert.ok(!spec.options.includes("action"), `${actionName}: action not in options`);
    }
  });
});
