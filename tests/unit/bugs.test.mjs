import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotionActions } from "../../scripts/actions.mjs";

/**
 * Helper: create a NotionActions instance with a mocked Notion client.
 * Bypasses rate limiter and tracks API calls for assertions.
 */
function createMockActions(clientOverrides = {}) {
  const actions = new NotionActions("ntn_test_token");
  actions._call = async (fn) => fn(); // bypass rate limiter
  actions.client = {
    databases: { retrieve: async () => ({}), create: async () => ({}) },
    dataSources: { retrieve: async () => ({}), query: async () => ({ results: [] }) },
    pages: { create: async () => ({}), retrieve: async () => ({}) },
    ...clientOverrides,
  };
  return actions;
}

describe("Bug 1: addDatabaseEntry schema lookup", () => {
  it("retrieves schema from dataSources.retrieve, not databases.retrieve", async () => {
    const calls = [];

    const actions = createMockActions({
      databases: {
        retrieve: async ({ database_id }) => {
          calls.push({ method: "databases.retrieve", database_id });
          // API 2025-09-03: databases.retrieve returns data_sources but NOT properties
          return {
            id: database_id,
            data_sources: [{ data_source_id: "ds-001" }],
          };
        },
      },
      dataSources: {
        retrieve: async ({ data_source_id }) => {
          calls.push({ method: "dataSources.retrieve", data_source_id });
          return {
            properties: {
              Name: { type: "title" },
              Status: { type: "select" },
            },
          };
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

    // Must call dataSources.retrieve to get the schema
    const dsRetrieveCall = calls.find((c) => c.method === "dataSources.retrieve");
    assert.ok(dsRetrieveCall, "addDatabaseEntry must call dataSources.retrieve for schema");
    assert.equal(dsRetrieveCall.data_source_id, "ds-001");

    // The page.create call must include properly typed properties
    const createCall = calls.find((c) => c.method === "pages.create");
    assert.ok(createCall, "addDatabaseEntry must call pages.create");
    assert.deepEqual(createCall.params.properties.Name, {
      title: [{ text: { content: "Test Entry" } }],
    });
    assert.deepEqual(createCall.params.properties.Status, {
      select: { name: "Done" },
    });
  });

  it("skips unknown properties not in schema", async () => {
    const actions = createMockActions({
      databases: {
        retrieve: async ({ database_id }) => ({
          id: database_id,
          data_sources: [{ data_source_id: "ds-002" }],
        }),
      },
      dataSources: {
        retrieve: async () => ({
          properties: { Name: { type: "title" } },
        }),
      },
      pages: {
        create: async (params) => {
          // Verify "Bogus" was NOT included
          assert.equal(params.properties.Bogus, undefined, "Unknown properties should be skipped");
          return { id: "p1", url: "https://notion.so/p1" };
        },
      },
    });

    const result = await actions.addDatabaseEntry("aabbccdd11223344aabbccdd11223344", {
      Name: "Hello",
      Bogus: "should be skipped",
    });
    assert.equal(result.success, true, `Expected success but got: ${result.error}`);
  });
});

describe("importTable", () => {
  it("creates database with inferred schema and inserts rows", async () => {
    const calls = [];

    const actions = createMockActions({
      databases: {
        retrieve: async ({ database_id }) => ({
          id: database_id,
          data_sources: [{ data_source_id: "ds-import" }],
        }),
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

    assert.equal(result.success, true, `Expected success but got: ${result.error}`);
    assert.equal(result.databaseId, "new-db-id");
    assert.equal(result.entriesCreated, 2);
    assert.deepEqual(result.errors, []);

    // Check schema: Name=title, Score=number, Status=select (repeats)
    const createCall = calls.find((c) => c.method === "databases.create");
    const schema = createCall.params.initial_data_source.properties;
    assert.ok(schema.Name.title, "Name should be title");
    assert.ok(schema.Score.number !== undefined, "Score should be number");
    assert.ok(schema.Status.select, "Status should be select");

    // Check row inserts used pages.create directly (not addDatabaseEntry)
    const pageCreates = calls.filter((c) => c.method === "pages.create");
    assert.equal(pageCreates.length, 2);
    assert.equal(pageCreates[0].params.parent.data_source_id, "ds-import");
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
        retrieve: async ({ database_id }) => ({
          id: database_id,
          data_sources: [{ data_source_id: "ds-err" }],
        }),
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
    assert.ok(result.errors[0].error.includes("Rate limited"));
  });
});

describe("Bug 2: createDatabase parent.type", () => {
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

    const schema = { Name: { title: {} } };
    const result = await actions.createDatabase("aabbccdd11223344aabbccdd11223344", "Test DB", schema);

    assert.equal(result.success, true, `Expected success but got: ${result.error}`);
    assert.equal(capturedParams.parent.type, "page_id", "parent must include type: 'page_id'");
    assert.ok(capturedParams.parent.page_id, "parent must include page_id");
  });
});
