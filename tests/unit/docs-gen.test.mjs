import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ACTION_CATALOG, ACTIONS } from "../../scripts/actions.mjs";

describe("doc freshness", () => {
  it("generated docs are up to date (--check)", async () => {
    const result = await new Promise((resolve) => {
      execFile("node", ["scripts/notion/docs/generate-skill-docs.mjs", "--check"], (err, stdout, stderr) => {
        resolve({ code: err?.code || 0, stdout, stderr });
      });
    });
    assert.equal(
      result.code,
      0,
      `Docs are stale: ${result.stderr}. Run: node scripts/notion/docs/generate-skill-docs.mjs`,
    );
  });
});

describe("skill display field consistency", () => {
  for (const [name, meta] of Object.entries(ACTION_CATALOG)) {
    if (meta.skill.includeInDecisionTree) {
      it(`${name} has routeLabel for decision tree`, () => {
        assert.ok(meta.skill.routeLabel, `${name}: includeInDecisionTree is true but routeLabel is missing`);
      });
    }

    if (meta.skill.includeInQuickPatterns) {
      it(`${name} has quickPattern`, () => {
        assert.ok(meta.skill.quickPattern, `${name}: includeInQuickPatterns is true but quickPattern is missing`);
      });
    }

    if (meta.docs.workflow) {
      it(`${name} has workflowTitle`, () => {
        assert.ok(meta.docs.workflowTitle, `${name}: docs.workflow is true but workflowTitle is missing`);
      });
    }
  }
});

describe("action-reference coverage", () => {
  it("every ACTIONS key appears in SKILL.md or action-reference.md", async () => {
    const skill = await readFile("skills/notion-agent-cli/SKILL.md", "utf-8");
    const ref = await readFile("skills/notion-agent-cli/references/action-reference.md", "utf-8");
    const combined = skill + ref;
    for (const name of Object.keys(ACTIONS)) {
      assert.ok(combined.includes(name), `Missing from SKILL.md + action-reference.md: ${name}`);
    }
  });
});
