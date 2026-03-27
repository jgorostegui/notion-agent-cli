import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotionActions } from "../../scripts/actions.mjs";

function createMockActions(clientOverrides = {}) {
  const actions = new NotionActions("ntn_test_token");
  actions._call = async (fn) => fn();
  actions.client = {
    databases: { retrieve: async () => ({}), create: async () => ({}) },
    dataSources: { retrieve: async () => ({}), query: async () => ({ results: [] }) },
    pages: { create: async () => ({}), retrieve: async () => ({}), update: async () => ({}) },
    blocks: {
      children: { list: async () => ({ results: [] }), append: async () => ({ results: [] }) },
      delete: async () => ({}),
    },
    ...clientOverrides,
  };
  return actions;
}

describe("addDatabaseEntry schema lookup", () => {
  it("retrieves schema from dataSources.retrieve, not databases.retrieve", async () => {
    const calls = [];
    const actions = createMockActions({
      databases: {
        retrieve: async ({ database_id }) => {
          calls.push({ method: "databases.retrieve", database_id });
          return { id: database_id, data_sources: [{ data_source_id: "ds-001" }] };
        },
      },
      dataSources: {
        retrieve: async ({ data_source_id }) => {
          calls.push({ method: "dataSources.retrieve", data_source_id });
          return { properties: { Name: { type: "title" }, Status: { type: "select" } } };
        },
      },
      pages: {
        create: async (params) => {
          calls.push({ method: "pages.create", params });
          return { id: "new-page-id", url: "https://notion.so/new-page" };
        },
      },
    });

    const result = await actions.addDatabaseEntry("aabbccdd11223344aabbccdd11223344", {
      Name: "Test Entry",
      Status: "Done",
    });
    assert.equal(result.success, true, `Expected success but got: ${result.error}`);
    const dsCall = calls.find((c) => c.method === "dataSources.retrieve");
    assert.ok(dsCall);
    assert.equal(dsCall.data_source_id, "ds-001");
  });

  it("skips unknown properties not in schema", async () => {
    const actions = createMockActions({
      databases: {
        retrieve: async ({ database_id }) => ({ id: database_id, data_sources: [{ data_source_id: "ds-002" }] }),
      },
      dataSources: { retrieve: async () => ({ properties: { Name: { type: "title" } } }) },
      pages: {
        create: async (params) => {
          assert.equal(params.properties.Bogus, undefined);
          return { id: "p1", url: "https://notion.so/p1" };
        },
      },
    });
    const result = await actions.addDatabaseEntry("aabbccdd11223344aabbccdd11223344", { Name: "Hello", Bogus: "skip" });
    assert.equal(result.success, true);
  });
});

describe("importTable", () => {
  it("creates database with inferred schema and inserts rows", async () => {
    const calls = [];
    const actions = createMockActions({
      databases: {
        retrieve: async ({ database_id }) => ({ id: database_id, data_sources: [{ data_source_id: "ds-import" }] }),
        create: async (params) => {
          calls.push({ method: "databases.create", params });
          return { id: "new-db-id", url: "https://notion.so/new-db" };
        },
      },
      pages: {
        create: async (params) => {
          calls.push({ method: "pages.create", params });
          return { id: "page-id", url: "https://notion.so/page" };
        },
      },
    });

    const md = "| Name | Score | Status |\n| --- | --- | --- |\n| Alice | 95 | Done |\n| Bob | 82 | Done |";
    const result = await actions.importTable("aabbccdd11223344aabbccdd11223344", md, { title: "Test" });
    assert.equal(result.success, true);
    assert.equal(result.entriesCreated, 2);
    assert.deepEqual(result.errors, []);
  });

  it("returns error for non-table content", async () => {
    const actions = createMockActions();
    const result = await actions.importTable("aabbccdd11223344aabbccdd11223344", "just some text");
    assert.equal(result.success, false);
    assert.ok(result.error.includes("No valid markdown table"));
  });

  it("collects individual entry failures without aborting", async () => {
    let callCount = 0;
    const actions = createMockActions({
      databases: {
        retrieve: async ({ database_id }) => ({ id: database_id, data_sources: [{ data_source_id: "ds-err" }] }),
        create: async () => ({ id: "db-id", url: "https://notion.so/db" }),
      },
      pages: {
        create: async () => {
          callCount++;
          if (callCount === 2) throw new Error("Rate limited");
          return { id: `p${callCount}`, url: "https://notion.so/p" };
        },
      },
    });

    const md = "| Name | Val |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n| C | 3 |";
    const result = await actions.importTable("aabbccdd11223344aabbccdd11223344", md);
    assert.equal(result.success, true);
    assert.equal(result.entriesCreated, 2);
    assert.equal(result.errors.length, 1);
  });
});

describe("createDatabase parent.type", () => {
  it("includes type: 'page_id' in parent object", async () => {
    let capturedParams;
    const actions = createMockActions({
      databases: {
        create: async (params) => {
          capturedParams = params;
          return { id: "new-db-id", url: "https://notion.so/new-db" };
        },
      },
    });

    const result = await actions.createDatabase("aabbccdd11223344aabbccdd11223344", "Test DB", { Name: { title: {} } });
    assert.equal(result.success, true);
    assert.equal(capturedParams.parent.type, "page_id");
  });
});

// ── Append pipeline ─────────────────────────────────────────────────────────

describe("appendBlocks with deep nesting", () => {
  it("splits 3-level nesting into two-pass appends", async () => {
    const appendCalls = [];
    const actions = createMockActions({
      blocks: {
        children: {
          list: async ({ block_id }) => {
            if (block_id === "created-top-0") return { results: [{ id: "created-child-0" }], has_more: false };
            return { results: [], has_more: false };
          },
          append: async (params) => {
            appendCalls.push(params);
            return { results: params.children.map((_, i) => ({ id: `created-top-${i}` })) };
          },
        },
      },
    });

    await actions.appendBlocks("aabbccdd11223344aabbccdd11223344", "- L1\n  - L2\n    - L3");
    assert.ok(appendCalls.length >= 2);
    const l2 = appendCalls[0].children[0]?.bulleted_list_item?.children?.[0];
    assert.ok(l2);
    assert.equal(l2?.bulleted_list_item?.children, undefined, "L3 should not be in first append");
  });
});

describe("createPage deep nesting", () => {
  it("embeds children when no deep nesting (fast path)", async () => {
    let createParams;
    const actions = createMockActions({
      pages: {
        create: async (params) => {
          createParams = params;
          return { id: "p1", url: "https://notion.so/p1" };
        },
      },
      blocks: {
        children: {
          append: async (params) => ({ results: params.children.map((_, i) => ({ id: `b${i}` })) }),
          list: async () => ({ results: [], has_more: false }),
        },
      },
    });
    await actions.createPage("aabbccdd11223344aabbccdd11223344", "Test", "- L1\n  - L2");
    assert.ok(createParams.children.length > 0);
  });

  it("creates empty page and appends when deep nesting detected (fallback)", async () => {
    let createParams;
    const actions = createMockActions({
      pages: {
        create: async (params) => {
          createParams = params;
          return { id: "p1", url: "https://notion.so/p1" };
        },
      },
      blocks: {
        children: {
          append: async (params) => ({ results: params.children.map((_, i) => ({ id: `b${i}` })) }),
          list: async ({ block_id }) => {
            if (block_id === "b0") return { results: [{ id: "child-0" }], has_more: false };
            return { results: [], has_more: false };
          },
        },
      },
    });
    await actions.createPage("aabbccdd11223344aabbccdd11223344", "Test", "- L1\n  - L2\n    - L3");
    assert.deepEqual(createParams.children, []);
  });
});

describe("_appendInBatches", () => {
  it("returns all created IDs across multiple batches (100/101 boundary)", async () => {
    let callCount = 0;
    const actions = createMockActions({
      blocks: {
        children: {
          append: async (params) => {
            callCount++;
            return { results: params.children.map((_, i) => ({ id: `batch${callCount}-${i}` })) };
          },
        },
      },
    });
    const blocks = Array.from({ length: 101 }, (_, i) => ({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: `Block ${i}` } }] },
    }));
    const ids = await actions._appendInBatches("aabbccdd11223344aabbccdd11223344", blocks);
    assert.equal(callCount, 2);
    assert.equal(ids.length, 101);
  });
});

// ── _callBatch ──────────────────────────────────────────────────────────────

describe("_callBatch", () => {
  it("runs tasks concurrently up to limit", async () => {
    const actions = createMockActions();
    let maxConcurrent = 0,
      current = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
      current++;
      if (current > maxConcurrent) maxConcurrent = current;
      await new Promise((r) => setTimeout(r, 10));
      current--;
      return "ok";
    });
    const results = await actions._callBatch(tasks, 3);
    assert.equal(results.length, 10);
    assert.ok(results.every((r) => r.ok));
    assert.ok(maxConcurrent <= 3);
  });

  it("collects errors without aborting other tasks", async () => {
    const actions = createMockActions();
    const results = await actions._callBatch(
      [
        async () => "a",
        async () => {
          throw new Error("fail");
        },
        async () => "c",
      ],
      5,
    );
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.equal(results[2].ok, true);
  });
});
