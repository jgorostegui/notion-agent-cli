import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { blocksToMarkdown } from "../converters/blocks.mjs";
import { csvEscape, normalizeId } from "../helpers/ids.mjs";
import { extractDbTitle, extractPropertyValue, extractTitle } from "../helpers/properties.mjs";

export const readMethods = {
  async search(query, { type } = {}) {
    const params = { query: query || "", page_size: 100 };
    if (type) params.filter = { value: type, property: "object" };
    const results = [];
    let cursor;
    do {
      const resp = await this._call(() => this.client.search({ ...params, start_cursor: cursor }));
      results.push(...resp.results);
      cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);
    return results.map((r) => ({
      id: r.id,
      type: r.object,
      title: r.object === "page" ? extractTitle(r) : extractDbTitle(r),
      url: r.url,
      lastEdited: r.last_edited_time,
      parent: r.parent,
    }));
  },

  async getPage(pageId, { format = "markdown" } = {}) {
    const nid = normalizeId(pageId);
    const blocks = await this._fetchBlocksRecursive(nid);
    const page = await this._call(() => this.client.pages.retrieve({ page_id: nid }));
    if (format === "blocks") {
      return { title: extractTitle(page), blocks };
    }
    return `# ${extractTitle(page)}\n\n${blocksToMarkdown(blocks)}`;
  },

  async getDatabase(dbId) {
    const nid = normalizeId(dbId);
    const dsId = await this._resolveDataSourceId(nid);
    const db = await this._call(() => this.client.databases.retrieve({ database_id: nid }));
    const entries = await this._paginateQuery(dsId);
    return { title: extractDbTitle(db), schema: db.properties, entries, entryCount: entries.length };
  },

  async queryDatabase(dbId, { filter, sorts, limit } = {}) {
    const dsId = await this._resolveDataSourceId(normalizeId(dbId));
    return this._paginateQuery(dsId, { filter, sorts, limit });
  },

  async getTree(pageId, { depth = 3, _current = 0 } = {}) {
    const nid = normalizeId(pageId);
    const page = await this._call(() => this.client.pages.retrieve({ page_id: nid }));
    const tree = { id: nid, title: extractTitle(page), type: "page", children: [] };
    if (_current >= depth) return tree;
    const blocks = await this._fetchBlocksShallow(nid);
    for (const block of blocks) {
      if (block.type === "child_page") {
        tree.children.push(await this.getTree(block.id, { depth, _current: _current + 1 }));
      } else if (block.type === "child_database") {
        tree.children.push({
          id: block.id,
          title: block.child_database?.title || "Untitled",
          type: "database",
          children: [],
        });
      }
    }
    return tree;
  },

  async exportPage(pageId, path) {
    const md = await this.getPage(normalizeId(pageId));
    await mkdir(dirname(path), { recursive: true }).catch(() => {});
    await writeFile(path, md, "utf-8");
    return path;
  },

  async exportDatabase(dbId, path, { format = "csv" } = {}) {
    const data = await this.getDatabase(normalizeId(dbId));
    await mkdir(path, { recursive: true }).catch(() => {});
    if (format === "json") {
      const filePath = join(path, "entries.json");
      const rows = data.entries.map((entry) => {
        const row = { _id: entry.id };
        for (const [name, prop] of Object.entries(entry.properties || {})) row[name] = extractPropertyValue(prop);
        return row;
      });
      await writeFile(filePath, JSON.stringify(rows, null, 2), "utf-8");
      return filePath;
    }
    const filePath = join(path, "entries.csv");
    const rows = data.entries.map((entry) => {
      const row = {};
      for (const [name, prop] of Object.entries(entry.properties || {})) row[name] = extractPropertyValue(prop);
      return row;
    });
    if (rows.length > 0) {
      const headers = Object.keys(rows[0]);
      const csvLines = [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))];
      await writeFile(filePath, csvLines.join("\n"), "utf-8");
    } else {
      await writeFile(filePath, "", "utf-8");
    }
    return filePath;
  },

  async getComments(pageId) {
    const nid = normalizeId(pageId);
    const results = [];
    let cursor;
    do {
      const resp = await this._call(() =>
        this.client.comments.list({ block_id: nid, page_size: 100, start_cursor: cursor }),
      );
      results.push(...resp.results);
      cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);
    return results;
  },

  async getUsers() {
    const results = [];
    let cursor;
    do {
      const resp = await this._call(() => this.client.users.list({ page_size: 100, start_cursor: cursor }));
      results.push(...resp.results);
      cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);
    return results;
  },
};
