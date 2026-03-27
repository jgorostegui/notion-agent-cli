import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { blocksToMarkdown } from "../converters/blocks.mjs";
import { csvEscape, normalizeId, safeName } from "../helpers/ids.mjs";
import { extractPropertyValue, extractTitle } from "../helpers/properties.mjs";

export const safetyMethods = {
  async snapshot(pageId) {
    const nid = normalizeId(pageId);
    try {
      const snapId = `${nid}_${Date.now()}`;
      const blocks = await this._fetchBlocksRecursive(nid);
      this._snapshots.set(snapId, { pageId: nid, blocks, timestamp: new Date().toISOString() });
      while (this._snapshots.size > 20) {
        const oldest = this._snapshots.keys().next().value;
        this._snapshots.delete(oldest);
      }
      return { success: true, snapshotId: snapId };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async restore(snapId) {
    try {
      const snap = this._snapshots.get(snapId);
      if (!snap) return { success: false, error: "Snapshot not found" };
      const md = blocksToMarkdown(snap.blocks);
      await this.updatePage(snap.pageId, md, { _skipSnapshot: true });
      return { success: true, pageId: snap.pageId, restoredFrom: snap.timestamp };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async backupPage(pageId, dirPath) {
    const nid = normalizeId(pageId);
    try {
      await mkdir(dirPath, { recursive: true });
      const page = await this._call(() => this.client.pages.retrieve({ page_id: nid }));
      const title = extractTitle(page);
      const safe = safeName(title) || "page";
      const md = await this.getPage(nid);
      const filePath = join(dirPath, `${safe}.md`);
      await writeFile(filePath, md, "utf-8");
      const files = [filePath];
      const blocks = await this._fetchBlocksShallow(nid);
      for (const block of blocks) {
        if (block.type === "child_page") {
          const sub = await this.backupPage(block.id, join(dirPath, safe));
          if (sub.success) files.push(...sub.files);
        }
      }
      return { success: true, files, count: files.length };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async backupDatabase(dbId, dirPath) {
    const nid = normalizeId(dbId);
    try {
      await mkdir(dirPath, { recursive: true });
      const data = await this.getDatabase(nid);
      const schemaPath = join(dirPath, "schema.json");
      await writeFile(schemaPath, JSON.stringify(data.schema, null, 2), "utf-8");
      const rows = data.entries.map((entry) => {
        const row = { _id: entry.id };
        for (const [name, prop] of Object.entries(entry.properties || {})) row[name] = extractPropertyValue(prop);
        return row;
      });
      const jsonPath = join(dirPath, "entries.json");
      await writeFile(jsonPath, JSON.stringify(rows, null, 2), "utf-8");
      const csvPath = join(dirPath, "entries.csv");
      if (rows.length > 0) {
        const headers = Object.keys(rows[0]);
        const csvLines = [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))];
        await writeFile(csvPath, csvLines.join("\n"), "utf-8");
      } else {
        await writeFile(csvPath, "", "utf-8");
      }
      return { success: true, schema: schemaPath, json: jsonPath, csv: csvPath };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async transact(operations) {
    const snapIds = [];
    try {
      const pageIds = new Set();
      for (const op of operations) {
        if (op.pageId) pageIds.add(normalizeId(op.pageId));
      }
      for (const pid of pageIds) {
        const snap = await this.snapshot(pid);
        if (snap.success) snapIds.push(snap.snapshotId);
      }
      const results = [];
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const method = this[op.action];
        if (!method) throw new Error(`Unknown action: ${op.action}`);
        const result = await method.call(this, ...(op.args || []));
        results.push(result);
        if (result?.success === false) throw new Error(result.error || `Operation ${i} failed`);
      }
      return { success: true, results };
    } catch (e) {
      for (const sid of snapIds) await this.restore(sid).catch(() => {});
      return { success: false, rolledBack: true, failedAt: e.message, error: String(e) };
    }
  },
};
