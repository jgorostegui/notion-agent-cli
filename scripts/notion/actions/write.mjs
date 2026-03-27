import { _splitDeepChildren, markdownToBlocks } from "../converters/blocks.mjs";
import { richTextToMd, textToRichText } from "../converters/rich-text.mjs";
import { inferColumnTypes, parseMarkdownTableData } from "../converters/tables.mjs";
import { normalizeId } from "../helpers/ids.mjs";
import { buildPropertyValue } from "../helpers/properties.mjs";

export const writeMethods = {
  async createPage(parentId, title, contentMd, { parentType = "page" } = {}) {
    try {
      const nid = normalizeId(parentId);
      const blocks = contentMd ? markdownToBlocks(contentMd) : [];
      const firstBatch = blocks.slice(0, 100);
      const remaining = blocks.slice(100);
      let parent;
      if (parentType === "database") {
        const dsId = await this._resolveDataSourceId(nid);
        parent = { data_source_id: dsId };
      } else {
        parent = { page_id: nid };
      }
      const { deferred: firstDeferred } = _splitDeepChildren(firstBatch, 2);
      let page;
      if (firstDeferred.length === 0) {
        page = await this._call(() =>
          this.client.pages.create({
            parent,
            properties: { title: [{ text: { content: title || "" } }] },
            children: firstBatch,
          }),
        );
        if (remaining.length > 0) await this._appendWithDeepChildren(page.id, remaining);
      } else {
        page = await this._call(() =>
          this.client.pages.create({
            parent,
            properties: { title: [{ text: { content: title || "" } }] },
            children: [],
          }),
        );
        await this._appendWithDeepChildren(page.id, blocks);
      }
      return { success: true, pageId: page.id, url: page.url };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updatePage(pageId, contentMd, { _skipSnapshot = false } = {}) {
    const nid = normalizeId(pageId);
    try {
      if (!_skipSnapshot) await this.snapshot(nid);
      const existing = await this._fetchBlocksShallow(nid);
      for (const block of existing) {
        if (block.type === "child_page" || block.type === "child_database") continue;
        await this._call(() => this.client.blocks.delete({ block_id: block.id })).catch(() => {});
      }
      const blocks = markdownToBlocks(contentMd);
      await this._appendWithDeepChildren(nid, blocks);
      return { success: true, pageId: nid };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async appendBlocks(pageId, contentMd) {
    try {
      const nid = normalizeId(pageId);
      const blocks = markdownToBlocks(contentMd);
      await this._appendWithDeepChildren(nid, blocks);
      return { success: true, pageId: nid };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async insertBlocks(pageId, contentMd, { after, atHeading, atStart } = {}) {
    const nid = normalizeId(pageId);
    try {
      const blocks = markdownToBlocks(contentMd);
      if (atHeading && !after) {
        const existing = await this._fetchBlocksShallow(nid);
        for (const block of existing) {
          const t = block.type;
          if (t?.startsWith("heading_")) {
            const text = richTextToMd(block[t]?.rich_text);
            if (text.toLowerCase().includes(atHeading.toLowerCase())) {
              after = block.id;
              break;
            }
          }
        }
        if (!after) return { success: false, error: "Heading not found" };
      }
      let position;
      if (after) {
        position = { type: "after_block", after_block: { id: normalizeId(after) } };
      } else if (atStart) {
        position = { type: "start" };
      } else {
        position = { type: "end" };
      }
      const blockIds = await this._appendAtPositionWithDeepChildren(nid, blocks, position);
      return { success: true, blockIds };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async setProperties(pageId, props) {
    try {
      const nid = normalizeId(pageId);
      const page = await this._call(() => this.client.pages.retrieve({ page_id: nid }));
      const parentType = page.parent?.type;
      let properties = props;
      if (parentType === "database_id" || parentType === "data_source_id") {
        const dsId = page.parent.data_source_id || (await this._resolveDataSourceId(page.parent.database_id));
        const ds = await this._call(() => this.client.dataSources.retrieve({ data_source_id: dsId }));
        properties = {};
        for (const [name, value] of Object.entries(props)) {
          const propSchema = ds.properties?.[name];
          const isSimple = typeof value === "string" || typeof value === "number" || typeof value === "boolean";
          if (propSchema && isSimple) {
            properties[name] = buildPropertyValue(propSchema.type, value);
          } else {
            properties[name] = value;
          }
        }
      }
      await this._call(() => this.client.pages.update({ page_id: nid, properties }));
      return { success: true, pageId: nid };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async addComment(pageId, text) {
    try {
      const nid = normalizeId(pageId);
      await this._call(() =>
        this.client.comments.create({
          parent: { page_id: nid },
          rich_text: textToRichText(text),
        }),
      );
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async lockPage(pageId) {
    try {
      const nid = normalizeId(pageId);
      await this._call(() => this.client.pages.update({ page_id: nid, is_locked: true }));
      return { success: true, pageId: nid };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async unlockPage(pageId) {
    try {
      const nid = normalizeId(pageId);
      await this._call(() => this.client.pages.update({ page_id: nid, is_locked: false }));
      return { success: true, pageId: nid };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createDatabase(parentId, title, schema) {
    try {
      const nid = normalizeId(parentId);
      const db = await this._call(() =>
        this.client.databases.create({
          parent: { type: "page_id", page_id: nid },
          title: [{ text: { content: title || "" } }],
          initial_data_source: { properties: schema },
        }),
      );
      return { success: true, databaseId: db.id, url: db.url };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async addDatabaseEntry(dbId, values) {
    try {
      const nid = normalizeId(dbId);
      const dsId = await this._resolveDataSourceId(nid);
      const ds = await this._call(() => this.client.dataSources.retrieve({ data_source_id: dsId }));
      const properties = {};
      for (const [name, value] of Object.entries(values)) {
        const propSchema = ds.properties?.[name];
        if (!propSchema) continue;
        properties[name] = buildPropertyValue(propSchema.type, value);
      }
      const page = await this._call(() =>
        this.client.pages.create({
          parent: { data_source_id: dsId },
          properties,
        }),
      );
      return { success: true, pageId: page.id, url: page.url };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async importTable(parentId, content, { title } = {}) {
    const parsed = parseMarkdownTableData(content);
    if (!parsed) return { success: false, error: "No valid markdown table found in content" };
    const types = inferColumnTypes(parsed.headers, parsed.rows);
    const schema = {};
    for (const header of parsed.headers) {
      const type = types[header];
      if (type === "title") {
        schema[header] = { title: {} };
      } else if (type === "select") {
        const colIdx = parsed.headers.indexOf(header);
        const unique = [...new Set(parsed.rows.map((r) => r[colIdx]).filter(Boolean))];
        schema[header] = { select: { options: unique.map((v) => ({ name: v })) } };
      } else {
        schema[header] = { [type]: {} };
      }
    }
    const dbResult = await this.createDatabase(normalizeId(parentId), title || "Imported Table", schema);
    if (!dbResult.success) return dbResult;
    const dsId = await this._resolveDataSourceId(dbResult.databaseId);
    const tasks = parsed.rows.map((row) => () => {
      const properties = {};
      parsed.headers.forEach((h, idx) => {
        if (!row[idx]) return;
        const t = types[h];
        let val = row[idx];
        if (t === "number") val = Number(val);
        else if (t === "checkbox") val = /^(true|yes)$/i.test(val);
        properties[h] = buildPropertyValue(t, val);
      });
      return this.client.pages.create({ parent: { data_source_id: dsId }, properties });
    });
    const results = await this._callBatch(tasks, 5);
    let created = 0;
    const errors = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].ok) {
        created++;
      } else {
        errors.push({
          row: Object.fromEntries(parsed.headers.map((h, idx) => [h, parsed.rows[i][idx]])),
          error: String(results[i].error),
        });
      }
    }
    return { success: true, databaseId: dbResult.databaseId, url: dbResult.url, entriesCreated: created, errors };
  },
};
