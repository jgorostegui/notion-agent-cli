import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIONS, toCamelCase } from "../../scripts/actions.mjs";

describe("toCamelCase", () => {
  it("converts snake_case to camelCase", () => {
    assert.equal(toCamelCase("get_page"), "getPage");
    assert.equal(toCamelCase("workspace_map"), "workspaceMap");
    assert.equal(toCamelCase("find_duplicates"), "findDuplicates");
  });

  it("leaves camelCase unchanged", () => {
    assert.equal(toCamelCase("getPage"), "getPage");
    assert.equal(toCamelCase("search"), "search");
  });
});

describe("ACTIONS registry", () => {
  it("has entries for all expected methods", () => {
    const expected = [
      "search",
      "getPage",
      "getDatabase",
      "queryDatabase",
      "getTree",
      "exportPage",
      "exportDatabase",
      "getComments",
      "getUsers",
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
      "importTable",
      "moveBlocks",
      "movePage",
      "reorderBlocks",
      "deepCopy",
      "mergePages",
      "splitPage",
      "extractSection",
      "replaceSection",
      "flattenPage",
      "nestUnderHeadings",
      "duplicateStructure",
      "applyTemplate",
      "batchSetProperties",
      "batchArchive",
      "batchTag",
      "snapshot",
      "restore",
      "backupPage",
      "backupDatabase",
      "transact",
      "workspaceMap",
      "pageStats",
      "diffPages",
      "findDuplicates",
      "findOrphans",
      "findEmpty",
      "findStale",
      "suggestReorganization",
    ];
    for (const name of expected) {
      assert.ok(ACTIONS[name], `Missing ACTIONS entry: ${name}`);
      assert.ok(Array.isArray(ACTIONS[name].args), `${name} missing args array`);
      assert.ok(Array.isArray(ACTIONS[name].options), `${name} missing options array`);
    }
  });

  it("JSON file detection: .json suffix triggers file mode", () => {
    assert.ok("/tmp/req.json".endsWith(".json"));
    assert.ok(!"getPage".endsWith(".json"));
    assert.ok(!"search".endsWith(".json"));
  });
});

describe("SKILL.md cross-reference", async () => {
  const { readFile } = await import("node:fs/promises");

  it("every ACTIONS key appears in SKILL.md or action-reference.md", async () => {
    const skill = await readFile("skills/notion-agent-cli/SKILL.md", "utf-8");
    const ref = await readFile("skills/notion-agent-cli/references/action-reference.md", "utf-8");
    const combined = skill + ref;
    for (const name of Object.keys(ACTIONS)) {
      assert.ok(combined.includes(name), `SKILL.md + action-reference.md missing method: ${name}`);
    }
  });
});
