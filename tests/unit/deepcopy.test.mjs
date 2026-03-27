import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { _sanitizeBlockForCreate, NotionActions } from "../../scripts/actions.mjs";

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

// ── deepCopy page shell ─────────────────────────────────────────────────────

describe("deepCopy page shell", () => {
  it("copies icon, cover, and rich text title", async () => {
    let createParams;
    const actions = createMockActions({
      pages: {
        create: async (params) => {
          createParams = params;
          return { id: "new-page" };
        },
        retrieve: async () => ({
          properties: {
            title: {
              type: "title",
              title: [
                {
                  type: "text",
                  text: { content: "My Page" },
                  plain_text: "My Page",
                  annotations: {
                    bold: true,
                    italic: false,
                    strikethrough: false,
                    underline: false,
                    code: false,
                    color: "default",
                  },
                },
              ],
            },
          },
          icon: { type: "emoji", emoji: "🎯" },
          cover: { type: "external", external: { url: "https://example.com/cover.png" } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: { list: async () => ({ results: [], has_more: false }), append: async () => ({ results: [] }) },
      },
    });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.deepEqual(createParams.icon, { type: "emoji", emoji: "🎯" });
    assert.deepEqual(createParams.cover, { type: "external", external: { url: "https://example.com/cover.png" } });
    assert.ok(createParams.properties.title[0].annotations.bold);
  });

  it("copies is_locked via pages.update", async () => {
    let updateCalled = false;
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: {
            title: { type: "title", title: [{ type: "text", text: { content: "Locked" }, plain_text: "Locked" }] },
          },
          is_locked: true,
        }),
        update: async (params) => {
          if (params.is_locked) updateCalled = true;
          return {};
        },
      },
      blocks: {
        children: { list: async () => ({ results: [], has_more: false }), append: async () => ({ results: [] }) },
      },
    });

    await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.ok(updateCalled);
  });

  it("re-uploads Notion-hosted file icon via _reuploadNotionFile", async () => {
    let createParams;
    const actions = createMockActions({
      pages: {
        create: async (params) => {
          createParams = params;
          return { id: "new-page" };
        },
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
          icon: { type: "file", file: { url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/test/icon.png" } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: { list: async () => ({ results: [], has_more: false }), append: async () => ({ results: [] }) },
      },
    });
    actions._reuploadNotionFile = async () => ({ type: "file_upload", file_upload: { id: "upload-123" } });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.deepEqual(createParams.icon, { type: "file_upload", file_upload: { id: "upload-123" } });
  });
});

// ── deepCopy rollback and error handling ─────────────────────────────────────

describe("deepCopy error handling", () => {
  it("archives page on root content copy failure", async () => {
    let archivedId;
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page-123" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async (params) => {
          if (params.archived) archivedId = params.page_id;
          return {};
        },
      },
    });
    actions._deepCopyBlocks = async () => {
      throw new Error("API explosion");
    };

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, false);
    assert.ok(result.error.includes("Content copy failed (page archived)"));
    assert.equal(archivedId, "new-page-123");
  });

  it("propagates child_database row errors as warnings", async () => {
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: {
          list: async () => ({
            results: [
              { type: "paragraph", paragraph: { rich_text: [] } },
              { type: "child_database", id: "db-block-1" },
            ],
            has_more: false,
          }),
          append: async (params) => ({ results: params.children.map((_, i) => ({ id: `created-${i}` })) }),
        },
      },
    });
    actions._cloneDatabase = async () => ({
      success: true,
      databaseId: "new-db",
      entriesCloned: 1,
      errors: [{ error: "Row 2 failed" }],
      rowIdMap: new Map(),
    });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.ok(result.warnings.some((w) => w.type === "child_database_row" && w.error === "Row 2 failed"));
  });

  it("captures batch append failure as warning instead of trashing page", async () => {
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: {
          list: async () => ({
            results: [
              {
                type: "paragraph",
                id: "p1",
                has_children: false,
                paragraph: { rich_text: [{ type: "text", text: { content: "text" }, plain_text: "text" }] },
              },
            ],
            has_more: false,
          }),
          append: async () => {
            throw new Error("API validation error");
          },
        },
      },
    });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.ok(result.warnings.some((w) => w.type === "batch_append_failed"));
  });
});

// ── deepCopy block recursion ────────────────────────────────────────────────

describe("deepCopy block recursion", () => {
  it("recursively copies blocks with has_children", async () => {
    const appendCalls = [];
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: {
          list: async ({ block_id }) => {
            if (block_id === "aabbccdd-1122-3344-aabb-ccdd11223344") {
              return {
                results: [
                  {
                    type: "toggle",
                    id: "toggle-1",
                    has_children: true,
                    toggle: { rich_text: [{ plain_text: "Toggle" }] },
                  },
                ],
                has_more: false,
              };
            }
            if (block_id === "toggle-1") {
              return {
                results: [
                  {
                    type: "paragraph",
                    id: "p-child",
                    has_children: false,
                    paragraph: { rich_text: [{ plain_text: "Child text" }] },
                  },
                ],
                has_more: false,
              };
            }
            return { results: [], has_more: false };
          },
          append: async (params) => {
            appendCalls.push(params);
            return { results: params.children.map((_, i) => ({ id: `created-${appendCalls.length}-${i}` })) };
          },
        },
      },
    });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.ok(appendCalls.length >= 2, `Expected at least 2 append calls, got ${appendCalls.length}`);
  });

  it("includes table_row children inline for table blocks", async () => {
    const appendCalls = [];
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: {
          list: async ({ block_id }) => {
            if (block_id === "aabbccdd-1122-3344-aabb-ccdd11223344") {
              return {
                results: [
                  {
                    type: "table",
                    id: "t1",
                    has_children: true,
                    table: { table_width: 2, has_column_header: true, has_row_header: false },
                  },
                ],
                has_more: false,
              };
            }
            if (block_id === "t1") {
              return {
                results: [
                  {
                    type: "table_row",
                    id: "tr1",
                    has_children: false,
                    table_row: {
                      cells: [
                        [{ type: "text", text: { content: "A" }, plain_text: "A" }],
                        [{ type: "text", text: { content: "B" }, plain_text: "B" }],
                      ],
                    },
                  },
                ],
                has_more: false,
              };
            }
            return { results: [], has_more: false };
          },
          append: async (params) => {
            appendCalls.push(params);
            return { results: params.children.map((_, i) => ({ id: `created-${i}` })) };
          },
        },
      },
    });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    const tableBlock = appendCalls[0]?.children?.find((b) => b.type === "table");
    assert.ok(tableBlock, "table block should be in append call");
    assert.ok(tableBlock.table.children?.length > 0, "table should have inline table_row children");
  });

  it("includes column content inline for column_list blocks", async () => {
    const appendCalls = [];
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: {
          list: async ({ block_id }) => {
            if (block_id === "aabbccdd-1122-3344-aabb-ccdd11223344") {
              return {
                results: [{ type: "column_list", id: "cl1", has_children: true, column_list: {} }],
                has_more: false,
              };
            }
            if (block_id === "cl1") {
              return { results: [{ type: "column", id: "col1", has_children: true, column: {} }], has_more: false };
            }
            if (block_id === "col1") {
              return {
                results: [
                  {
                    type: "paragraph",
                    id: "p1",
                    has_children: false,
                    paragraph: {
                      rich_text: [{ type: "text", text: { content: "Column text" }, plain_text: "Column text" }],
                    },
                  },
                ],
                has_more: false,
              };
            }
            return { results: [], has_more: false };
          },
          append: async (params) => {
            appendCalls.push(params);
            return { results: params.children.map((_, i) => ({ id: `created-${i}` })) };
          },
        },
      },
    });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    const colList = appendCalls[0]?.children?.find((b) => b.type === "column_list");
    assert.ok(colList);
    const col = colList.column_list.children?.[0];
    assert.ok(col?.column.children?.length > 0, "column should have content children inline");
  });
});

// ── deepCopy media handling ─────────────────────────────────────────────────

describe("deepCopy media handling", () => {
  it("appends re-uploaded media blocks individually", async () => {
    const appendCalls = [];
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: {
          list: async () => ({
            results: [
              {
                type: "paragraph",
                id: "p1",
                has_children: false,
                paragraph: { rich_text: [{ type: "text", text: { content: "Before" }, plain_text: "Before" }] },
              },
              {
                type: "image",
                id: "img1",
                has_children: false,
                image: { type: "file", file: { url: "https://prod-files-secure.s3.example.com/img.png" } },
              },
              {
                type: "paragraph",
                id: "p2",
                has_children: false,
                paragraph: { rich_text: [{ type: "text", text: { content: "After" }, plain_text: "After" }] },
              },
            ],
            has_more: false,
          }),
          append: async (params) => {
            appendCalls.push(params.children.length);
            return { results: params.children.map((_, i) => ({ id: `created-${appendCalls.length}-${i}` })) };
          },
        },
      },
    });
    actions._reuploadNotionFile = async () => ({ type: "file_upload", file_upload: { id: "upload-1" } });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.ok(
      appendCalls.some((count) => count === 1),
      "Image should be appended individually",
    );
  });

  it("skips media block with warning when re-upload fails", async () => {
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: {
          list: async () => ({
            results: [
              {
                type: "image",
                id: "img1",
                has_children: false,
                image: { type: "file", file: { url: "https://expired.example.com/img.png" } },
              },
            ],
            has_more: false,
          }),
          append: async (params) => ({ results: params.children.map((_, i) => ({ id: `c-${i}` })) }),
        },
      },
    });
    actions._reuploadNotionFile = async () => undefined;

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.ok(result.warnings.some((w) => w.type === "media_upload_failed"));
  });
});

// ── _cloneDatabase ──────────────────────────────────────────────────────────

describe("_cloneDatabase", () => {
  it("clones schema, rows, and row bodies", async () => {
    const dbCreateCalls = [];
    const pageCreateCalls = [];
    const deepCopyBlocksCalls = [];
    const actions = createMockActions({
      databases: {
        retrieve: async () => ({ title: [{ plain_text: "Test DB" }], data_sources: [{ data_source_id: "ds1" }] }),
        create: async (params) => {
          dbCreateCalls.push(params);
          return { id: "new-db-id", url: "https://notion.so/new-db" };
        },
      },
      dataSources: {
        retrieve: async ({ data_source_id }) => {
          if (data_source_id === "ds1") {
            return {
              properties: {
                Name: { type: "title", title: {} },
                Count: { type: "number", number: {} },
                Created: { type: "created_time" },
                Formula1: { type: "formula", formula: {} },
                Rel: { type: "relation", relation: {} },
              },
            };
          }
          return { properties: {} };
        },
        query: async () => ({
          results: [
            {
              id: "row1",
              properties: {
                Name: { type: "title", title: [{ type: "text", text: { content: "A" }, plain_text: "A" }] },
                Count: { type: "number", number: 5 },
              },
            },
          ],
          has_more: false,
        }),
      },
      pages: {
        create: async (params) => {
          pageCreateCalls.push(params);
          return { id: `new-row-${pageCreateCalls.length}` };
        },
        retrieve: async () => ({}),
      },
      blocks: {
        children: { list: async () => ({ results: [], has_more: false }), append: async () => ({ results: [] }) },
      },
    });
    actions._deepCopyBlocks = async (srcId, tgtId) => {
      deepCopyBlocksCalls.push({ srcId, tgtId });
      return [];
    };

    const result = await actions._cloneDatabase("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    const schema = dbCreateCalls[0].initial_data_source.properties;
    assert.ok(schema.Name, "title column kept");
    assert.ok(schema.Count, "number column kept");
    assert.ok(schema.Rel, "relation column kept in schema (values deferred to v2)");
    assert.equal(schema.Created, undefined, "created_time excluded");
    assert.equal(schema.Formula1, undefined, "formula excluded");
    // Relation values should NOT be in row properties (need ID remapping)
    assert.equal(pageCreateCalls[0].properties.Rel, undefined, "relation values skipped in row");
    assert.equal(deepCopyBlocksCalls.length, 1);
    assert.ok(result.rowIdMap instanceof Map);
  });

  it("clones empty database (no data sources) as shell", async () => {
    const dbCreateCalls = [];
    const actions = createMockActions({
      databases: {
        retrieve: async () => ({ title: [{ plain_text: "Empty DB" }], data_sources: [], is_inline: true }),
        create: async (params) => {
          dbCreateCalls.push(params);
          return { id: "new-db", url: "https://notion.so/new-db" };
        },
      },
    });

    const result = await actions._cloneDatabase("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.equal(result.entriesCloned, 0);
    assert.equal(dbCreateCalls[0].is_inline, true);
  });

  it("propagates row creation errors", async () => {
    let callCount = 0;
    const actions = createMockActions({
      databases: {
        retrieve: async () => ({ title: [{ plain_text: "DB" }], data_sources: [{ data_source_id: "ds1" }] }),
        create: async () => ({ id: "new-db", url: "https://notion.so/db" }),
      },
      dataSources: {
        retrieve: async () => ({ properties: { Name: { type: "title", title: {} } } }),
        query: async () => ({
          results: [
            {
              id: "r1",
              properties: {
                Name: { type: "title", title: [{ type: "text", text: { content: "A" }, plain_text: "A" }] },
              },
            },
            {
              id: "r2",
              properties: {
                Name: { type: "title", title: [{ type: "text", text: { content: "B" }, plain_text: "B" }] },
              },
            },
          ],
          has_more: false,
        }),
      },
      pages: {
        create: async () => {
          callCount++;
          if (callCount === 2) throw new Error("Row create failed");
          return { id: `new-row-${callCount}` };
        },
        retrieve: async () => ({}),
      },
      blocks: {
        children: { list: async () => ({ results: [], has_more: false }), append: async () => ({ results: [] }) },
      },
    });
    actions._deepCopyBlocks = async () => [];

    const result = await actions._cloneDatabase("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.equal(result.entriesCloned, 1);
    assert.ok(result.errors.length > 0);
  });

  it("propagates row-body copy warnings through errors", async () => {
    const actions = createMockActions({
      databases: {
        retrieve: async () => ({ title: [{ plain_text: "DB" }], data_sources: [{ data_source_id: "ds1" }] }),
        create: async () => ({ id: "new-db", url: "https://notion.so/db" }),
      },
      dataSources: {
        retrieve: async () => ({ properties: { Name: { type: "title", title: {} } } }),
        query: async () => ({
          results: [
            {
              id: "r1",
              properties: {
                Name: { type: "title", title: [{ type: "text", text: { content: "A" }, plain_text: "A" }] },
              },
            },
          ],
          has_more: false,
        }),
      },
      pages: { create: async () => ({ id: "new-row-1" }), retrieve: async () => ({}) },
      blocks: {
        children: { list: async () => ({ results: [], has_more: false }), append: async () => ({ results: [] }) },
      },
    });
    // Stub _deepCopyBlocks to throw on the row body copy
    actions._deepCopyBlocks = async () => {
      throw new Error("Row body exploded");
    };

    const result = await actions._cloneDatabase("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.equal(result.entriesCloned, 1);
    assert.ok(
      result.errors.some((e) => e.error.includes("Row body")),
      "Row body error should be in errors array",
    );
  });

  it("clones empty database with description, icon, and cover", async () => {
    const dbCreateCalls = [];
    const actions = createMockActions({
      databases: {
        retrieve: async () => ({
          title: [{ plain_text: "DB with meta" }],
          data_sources: [],
          is_inline: true,
          description: [{ type: "text", text: { content: "A description" }, plain_text: "A description" }],
          icon: { type: "emoji", emoji: "🗂️" },
          cover: { type: "external", external: { url: "https://example.com/cover.png" } },
        }),
        create: async (params) => {
          dbCreateCalls.push(params);
          return { id: "new-db", url: "https://notion.so/new-db" };
        },
      },
    });

    const result = await actions._cloneDatabase("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.equal(dbCreateCalls[0].is_inline, true);
    assert.deepEqual(dbCreateCalls[0].icon, { type: "emoji", emoji: "🗂️" });
    assert.deepEqual(dbCreateCalls[0].cover, { type: "external", external: { url: "https://example.com/cover.png" } });
    assert.ok(dbCreateCalls[0].description?.[0]?.text?.content === "A description");
  });

  it("warns when database icon re-upload fails", async () => {
    const actions = createMockActions({
      databases: {
        retrieve: async () => ({
          title: [{ plain_text: "DB" }],
          data_sources: [{ data_source_id: "ds1" }],
          icon: { type: "file", file: { url: "https://expired.s3.example.com/icon.png" } },
        }),
        create: async () => ({ id: "new-db", url: "https://notion.so/db" }),
      },
      dataSources: {
        retrieve: async () => ({ properties: { Name: { type: "title", title: {} } } }),
        query: async () => ({ results: [], has_more: false }),
      },
    });
    // Stub _reuploadNotionFile to fail
    actions._reuploadNotionFile = async () => undefined;

    const result = await actions._cloneDatabase("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    // Icon should not be in the create call (re-upload failed)
    // No crash — graceful degradation
  });
});

// ── _sanitizeBlockForCreate edge cases ──────────────────────────────────────

describe("_sanitizeBlockForCreate rich_text chunking", () => {
  it("chunks code block rich_text exceeding 2000 chars", () => {
    const longText = "x".repeat(3500);
    const block = {
      type: "code",
      code: { rich_text: [{ type: "text", text: { content: longText } }], language: "python" },
    };
    const result = _sanitizeBlockForCreate(block);
    assert.ok(result.code.rich_text.length >= 2, `Expected >= 2 chunks, got ${result.code.rich_text.length}`);
    assert.ok(
      result.code.rich_text.every((rt) => rt.text.content.length <= 2000),
      "All chunks should be <= 2000 chars",
    );
    assert.equal(
      result.code.rich_text.map((rt) => rt.text.content).join(""),
      longText,
      "Concatenated chunks should equal original",
    );
  });

  it("preserves annotations when chunking", () => {
    const longText = "y".repeat(2500);
    const annotations = {
      bold: true,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "red",
    };
    const block = {
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: longText }, annotations }] },
    };
    const result = _sanitizeBlockForCreate(block);
    assert.ok(result.paragraph.rich_text.length >= 2);
    assert.ok(
      result.paragraph.rich_text.every((rt) => rt.annotations?.bold === true),
      "Annotations should be preserved on all chunks",
    );
  });

  it("does not chunk text already under 2000 chars", () => {
    const block = {
      type: "code",
      code: { rich_text: [{ type: "text", text: { content: "short code" } }], language: "js" },
    };
    const result = _sanitizeBlockForCreate(block);
    assert.equal(result.code.rich_text.length, 1);
  });
});

// ── Column-nested media and tables ──────────────────────────────────────────

describe("deepCopy column-nested content", () => {
  it("re-uploads Notion-hosted images inside columns", async () => {
    const appendCalls = [];
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: {
          list: async ({ block_id }) => {
            if (block_id === "aabbccdd-1122-3344-aabb-ccdd11223344") {
              return {
                results: [{ type: "column_list", id: "cl1", has_children: true, column_list: {} }],
                has_more: false,
              };
            }
            if (block_id === "cl1") {
              return { results: [{ type: "column", id: "col1", has_children: true, column: {} }], has_more: false };
            }
            if (block_id === "col1") {
              return {
                results: [
                  {
                    type: "image",
                    id: "img-in-col",
                    has_children: false,
                    image: { type: "file", file: { url: "https://prod-files-secure.s3.example.com/img.png" } },
                  },
                ],
                has_more: false,
              };
            }
            return { results: [], has_more: false };
          },
          append: async (params) => {
            appendCalls.push(params);
            return { results: params.children.map((_, i) => ({ id: `created-${i}` })) };
          },
        },
      },
    });
    actions._reuploadNotionFile = async () => ({ type: "file_upload", file_upload: { id: "upload-col-img" } });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    // The image inside the column should use file_upload, not file
    const colList = appendCalls[0]?.children?.find((b) => b.type === "column_list");
    const col = colList?.column_list?.children?.[0];
    const img = col?.column?.children?.[0];
    assert.ok(img, "Image should be inside column");
    assert.equal(img.image.type, "file_upload", "Image should be re-uploaded as file_upload");
    assert.equal(img.image.file_upload.id, "upload-col-img");
  });

  it("handles tables nested inside columns", async () => {
    const appendCalls = [];
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: {
          list: async ({ block_id }) => {
            if (block_id === "aabbccdd-1122-3344-aabb-ccdd11223344") {
              return {
                results: [{ type: "column_list", id: "cl1", has_children: true, column_list: {} }],
                has_more: false,
              };
            }
            if (block_id === "cl1") {
              return { results: [{ type: "column", id: "col1", has_children: true, column: {} }], has_more: false };
            }
            if (block_id === "col1") {
              return {
                results: [
                  {
                    type: "table",
                    id: "tbl-in-col",
                    has_children: true,
                    table: { table_width: 2, has_column_header: true, has_row_header: false },
                  },
                ],
                has_more: false,
              };
            }
            if (block_id === "tbl-in-col") {
              return {
                results: [
                  {
                    type: "table_row",
                    id: "tr1",
                    has_children: false,
                    table_row: {
                      cells: [
                        [{ type: "text", text: { content: "A" }, plain_text: "A" }],
                        [{ type: "text", text: { content: "B" }, plain_text: "B" }],
                      ],
                    },
                  },
                ],
                has_more: false,
              };
            }
            return { results: [], has_more: false };
          },
          append: async (params) => {
            appendCalls.push(params);
            return { results: params.children.map((_, i) => ({ id: `created-${i}` })) };
          },
        },
      },
    });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    const colList = appendCalls[0]?.children?.find((b) => b.type === "column_list");
    const col = colList?.column_list?.children?.[0];
    const tbl = col?.column?.children?.[0];
    assert.ok(tbl, "Table should be inside column");
    assert.ok(tbl.table.children?.length > 0, "Table should have inline table_row children");
  });

  it("skips invalid external URLs inside columns", async () => {
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: {
          list: async ({ block_id }) => {
            if (block_id === "aabbccdd-1122-3344-aabb-ccdd11223344") {
              return {
                results: [{ type: "column_list", id: "cl1", has_children: true, column_list: {} }],
                has_more: false,
              };
            }
            if (block_id === "cl1") {
              return { results: [{ type: "column", id: "col1", has_children: true, column: {} }], has_more: false };
            }
            if (block_id === "col1") {
              return {
                results: [
                  {
                    type: "image",
                    id: "bad-img",
                    has_children: false,
                    image: { type: "external", external: { url: "images/relative.png" } },
                  },
                  {
                    type: "paragraph",
                    id: "p1",
                    has_children: false,
                    paragraph: { rich_text: [{ type: "text", text: { content: "Kept" }, plain_text: "Kept" }] },
                  },
                ],
                has_more: false,
              };
            }
            return { results: [], has_more: false };
          },
          append: async (params) => ({ results: params.children.map((_, i) => ({ id: `created-${i}` })) }),
        },
      },
    });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.ok(result.warnings?.some((w) => w.type === "invalid_media_url_skipped"));
  });
});

// ── Invalid external URLs ───────────────────────────────────────────────────

describe("deepCopy invalid external media URLs", () => {
  it("skips data: URI images with warning", async () => {
    const appendCalls = [];
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: {
          list: async () => ({
            results: [
              {
                type: "paragraph",
                id: "p1",
                has_children: false,
                paragraph: { rich_text: [{ type: "text", text: { content: "Before" }, plain_text: "Before" }] },
              },
              {
                type: "image",
                id: "svg1",
                has_children: false,
                image: { type: "external", external: { url: "data:image/svg+xml,<svg/>" } },
              },
              {
                type: "paragraph",
                id: "p2",
                has_children: false,
                paragraph: { rich_text: [{ type: "text", text: { content: "After" }, plain_text: "After" }] },
              },
            ],
            has_more: false,
          }),
          append: async (params) => {
            appendCalls.push(params);
            return { results: params.children.map((_, i) => ({ id: `created-${i}` })) };
          },
        },
      },
    });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.ok(result.warnings?.some((w) => w.type === "invalid_media_url_skipped"));
    // Both paragraphs should be in the batch (SVG skipped, not batch-killing)
    const totalBlocks = appendCalls.reduce((sum, c) => sum + c.children.length, 0);
    assert.equal(totalBlocks, 2, "Both paragraphs should be appended, SVG skipped");
  });

  it("skips relative URL images with warning", async () => {
    const actions = createMockActions({
      pages: {
        create: async () => ({ id: "new-page" }),
        retrieve: async () => ({
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "X" }, plain_text: "X" }] } },
        }),
        update: async () => ({}),
      },
      blocks: {
        children: {
          list: async () => ({
            results: [
              {
                type: "image",
                id: "rel-img",
                has_children: false,
                image: { type: "external", external: { url: "images/dashboard.jpeg" } },
              },
            ],
            has_more: false,
          }),
          append: async (params) => ({ results: params.children.map((_, i) => ({ id: `created-${i}` })) }),
        },
      },
    });

    const result = await actions.deepCopy("aabbccdd11223344aabbccdd11223344", "11223344aabbccdd11223344aabbccdd");
    assert.equal(result.success, true);
    assert.ok(
      result.warnings?.some((w) => w.type === "invalid_media_url_skipped" && w.url?.includes("images/dashboard")),
    );
  });
});
