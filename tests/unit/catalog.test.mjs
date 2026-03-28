import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ACTION_ALIASES, ACTION_CATALOG, ACTIONS } from "../../scripts/actions.mjs";

const VALID_CATEGORIES = new Set(["read", "write", "structural", "batch", "safety", "analysis"]);
const VALID_RISKS = new Set(["low", "medium", "high"]);
const VALID_COSTS = new Set(["cheap", "moderate", "expensive"]);

describe("ACTION_CATALOG completeness", () => {
  for (const [name, meta] of Object.entries(ACTION_CATALOG)) {
    it(`${name} has all required fields`, () => {
      assert.ok(VALID_CATEGORIES.has(meta.category), `${name}: invalid category "${meta.category}"`);
      assert.ok(
        typeof meta.summary === "string" && meta.summary.length > 0,
        `${name}: summary must be non-empty string`,
      );
      assert.ok(Array.isArray(meta.args), `${name}: args must be array`);
      assert.ok(Array.isArray(meta.options), `${name}: options must be array`);
      assert.ok(Array.isArray(meta.aliases), `${name}: aliases must be array`);
      assert.ok(
        typeof meta.output === "object" && typeof meta.output.kind === "string",
        `${name}: output.kind required`,
      );
      assert.ok(typeof meta.mutates === "boolean", `${name}: mutates must be boolean`);
      assert.ok(VALID_RISKS.has(meta.risk), `${name}: invalid risk "${meta.risk}"`);
      assert.ok(VALID_COSTS.has(meta.costClass), `${name}: invalid costClass "${meta.costClass}"`);
      assert.ok(typeof meta.compound === "boolean", `${name}: compound must be boolean`);
      assert.ok(Array.isArray(meta.preferredFor), `${name}: preferredFor must be array`);
      assert.ok(Array.isArray(meta.preferInstead), `${name}: preferInstead must be array`);
      assert.ok(Array.isArray(meta.replacesWorkflows), `${name}: replacesWorkflows must be array`);
      assert.ok(Array.isArray(meta.examples) && meta.examples.length > 0, `${name}: examples must be non-empty array`);
      // skill
      assert.ok(typeof meta.skill === "object", `${name}: skill must be object`);
      assert.ok(
        typeof meta.skill.includeInQuickPatterns === "boolean",
        `${name}: skill.includeInQuickPatterns must be boolean`,
      );
      assert.ok(
        typeof meta.skill.includeInDecisionTree === "boolean",
        `${name}: skill.includeInDecisionTree must be boolean`,
      );
      assert.ok(Array.isArray(meta.skill.gotchas), `${name}: skill.gotchas must be array`);
      // docs
      assert.ok(typeof meta.docs === "object", `${name}: docs must be object`);
      assert.ok(typeof meta.docs.workflow === "boolean", `${name}: docs.workflow must be boolean`);
    });

    it(`${name} args have name and kind`, () => {
      for (const arg of meta.args) {
        assert.ok(typeof arg.name === "string", `${name}: arg missing name`);
        assert.ok(typeof arg.kind === "string", `${name}: arg ${arg.name} missing kind`);
      }
    });

    it(`${name} options have name`, () => {
      for (const opt of meta.options) {
        assert.ok(typeof opt.name === "string", `${name}: option missing name`);
      }
    });

    it(`${name} preferInstead entries are well-formed`, () => {
      for (const pi of meta.preferInstead) {
        assert.ok(typeof pi.intent === "string", `${name}: preferInstead entry missing intent`);
        assert.ok(typeof pi.action === "string", `${name}: preferInstead entry missing action`);
      }
    });
  }
});

describe("ACTIONS is the derived projection of ACTION_CATALOG", () => {
  it("has exactly the same keys", () => {
    assert.deepEqual(Object.keys(ACTIONS).sort(), Object.keys(ACTION_CATALOG).sort());
  });

  for (const [name, meta] of Object.entries(ACTION_CATALOG)) {
    it(`${name} args projection matches`, () => {
      assert.deepEqual(
        ACTIONS[name].args,
        meta.args.map((a) => a.name),
      );
    });
    it(`${name} options projection matches`, () => {
      assert.deepEqual(
        ACTIONS[name].options,
        meta.options.map((o) => o.name),
      );
    });
  }
});

describe("ACTION_ALIASES integrity", () => {
  it("every alias target is a real action", () => {
    for (const [alias, target] of Object.entries(ACTION_ALIASES)) {
      assert.ok(ACTION_CATALOG[target], `Alias "${alias}" -> "${target}" but "${target}" is not in ACTION_CATALOG`);
    }
  });

  it("no alias collides with an action name", () => {
    for (const alias of Object.keys(ACTION_ALIASES)) {
      assert.ok(!ACTION_CATALOG[alias], `Alias "${alias}" collides with action name`);
    }
  });

  it("no duplicate aliases across actions", () => {
    const seen = new Map();
    for (const [name, meta] of Object.entries(ACTION_CATALOG)) {
      for (const alias of meta.aliases) {
        assert.ok(!seen.has(alias), `Duplicate alias "${alias}" in ${name} and ${seen.get(alias)}`);
        seen.set(alias, name);
      }
    }
  });

  it("ACTION_ALIASES matches derived aliases from catalog", () => {
    const derived = Object.fromEntries(
      Object.entries(ACTION_CATALOG).flatMap(([action, meta]) => meta.aliases.map((alias) => [alias, action])),
    );
    assert.deepEqual(ACTION_ALIASES, derived);
  });

  it("every preferInstead[].action references a valid action", () => {
    for (const [name, meta] of Object.entries(ACTION_CATALOG)) {
      for (const pi of meta.preferInstead) {
        assert.ok(ACTION_CATALOG[pi.action], `${name}: preferInstead references unknown action "${pi.action}"`);
      }
    }
  });
});

describe("version sync", () => {
  it("package.json version matches plugin.json version", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf-8"));
    const plugin = JSON.parse(await readFile(".claude-plugin/plugin.json", "utf-8"));
    assert.equal(pkg.version, plugin.version);
  });

  it("SKILL.md frontmatter version matches package.json version or is omitted", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf-8"));
    const skill = await readFile("skills/notion-agent-cli/SKILL.md", "utf-8");
    const versionMatch = skill.match(/^version:\s*(.+)$/m);
    if (versionMatch) {
      assert.equal(versionMatch[1].trim(), pkg.version, "SKILL.md version does not match package.json");
    }
    // If no version in SKILL.md, that is also acceptable
  });
});

describe("benchmark-neutrality guards", () => {
  const BANNED = ["benchmark", "evaluation", "contamination", "BENCH_", "bench-"];

  it("SKILL.md does not contain benchmark terms", async () => {
    const content = await readFile("skills/notion-agent-cli/SKILL.md", "utf-8");
    for (const term of BANNED) {
      assert.ok(!content.includes(term), `SKILL.md contains banned term "${term}"`);
    }
  });

  it("plugin.json does not contain benchmark terms", async () => {
    const content = await readFile(".claude-plugin/plugin.json", "utf-8");
    for (const term of BANNED) {
      assert.ok(!content.includes(term), `plugin.json contains banned term "${term}"`);
    }
  });
});
