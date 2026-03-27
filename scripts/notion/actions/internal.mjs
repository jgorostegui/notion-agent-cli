import { _splitDeepChildren } from "../converters/blocks.mjs";
import { normalizeId } from "../helpers/ids.mjs";
import { ConcurrencyLimiter } from "../limiter.mjs";

export const internalMethods = {
  async _call(fn) {
    await this._limiter.acquire();
    try {
      this._apiCallCount++;
      if (this._verbose) {
        const name = fn.name || "anonymous";
        process.stderr.write(`[notion] ${name}\n`);
      }
      return await fn();
    } finally {
      this._limiter.release();
    }
  },

  async _callBatch(tasks, concurrency = 5) {
    const limiter = new ConcurrencyLimiter(concurrency);
    const results = [];
    const promises = tasks.map(async (fn, i) => {
      await limiter.acquire();
      try {
        this._apiCallCount++;
        if (this._verbose) {
          const name = fn.name || "anonymous";
          process.stderr.write(`[notion] batch ${name}\n`);
        }
        results[i] = { ok: true, value: await fn() };
      } catch (e) {
        results[i] = { ok: false, error: e };
      } finally {
        limiter.release();
      }
    });
    await Promise.all(promises);
    return results;
  },

  async _reuploadNotionFile(fileUrl) {
    try {
      const resp = await fetch(fileUrl);
      if (!resp.ok) return undefined;
      const contentType = resp.headers.get("content-type") || "application/octet-stream";
      const blob = await resp.blob();
      const urlPath = new URL(fileUrl).pathname;
      const filename = decodeURIComponent(urlPath.split("/").pop() || "file");
      const upload = await this._call(() =>
        this.client.fileUploads.create({ mode: "single_part", filename, content_type: contentType }),
      );
      await this._call(() =>
        this.client.fileUploads.send({ file_upload_id: upload.id, file: { filename, data: blob } }),
      );
      return { type: "file_upload", file_upload: { id: upload.id } };
    } catch {
      return undefined;
    }
  },

  async _fetchBlocksShallow(blockId) {
    const results = [];
    let cursor;
    do {
      const resp = await this._call(() =>
        this.client.blocks.children.list({ block_id: normalizeId(blockId), page_size: 100, start_cursor: cursor }),
      );
      results.push(...resp.results);
      cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);
    return results;
  },

  async _fetchBlocksRecursive(blockId, { maxBlocks = 5000 } = {}) {
    let total = 0;
    const recurse = async (id) => {
      const blocks = await this._fetchBlocksShallow(id);
      total += blocks.length;
      if (total > maxBlocks) return blocks;
      for (const block of blocks) {
        if (block.has_children && block.type !== "child_page" && block.type !== "child_database") {
          block.children = await recurse(block.id);
          if (total > maxBlocks) break;
        }
      }
      return blocks;
    };
    return recurse(normalizeId(blockId));
  },

  async _resolveDataSourceId(dbId) {
    const nid = normalizeId(dbId);
    if (this._dsCache.has(nid)) return this._dsCache.get(nid);
    try {
      const db = await this._call(() => this.client.databases.retrieve({ database_id: nid }));
      const dsId = db.data_sources?.[0]?.data_source_id || db.data_sources?.[0]?.id || nid;
      this._dsCache.set(nid, dsId);
      return dsId;
    } catch {
      await this._call(() => this.client.dataSources.retrieve({ data_source_id: nid }));
      this._dsCache.set(nid, nid);
      return nid;
    }
  },

  async _paginateQuery(dataSourceId, { filter, sorts, limit } = {}) {
    const results = [];
    let cursor;
    do {
      const params = { data_source_id: dataSourceId, page_size: 100, start_cursor: cursor };
      if (filter) params.filter = filter;
      if (sorts) params.sorts = sorts;
      const resp = await this._call(() => this.client.dataSources.query(params));
      results.push(...resp.results);
      cursor = resp.has_more ? resp.next_cursor : undefined;
      if (limit && results.length >= limit) {
        results.length = limit;
        break;
      }
    } while (cursor);
    return results;
  },

  async _appendInBatches(pageId, blocks) {
    const nid = normalizeId(pageId);
    const allIds = [];
    for (let i = 0; i < blocks.length; i += 100) {
      const chunk = blocks.slice(i, i + 100);
      const resp = await this._call(() => this.client.blocks.children.append({ block_id: nid, children: chunk }));
      allIds.push(...resp.results.map((r) => r.id));
    }
    return allIds;
  },

  async _appendWithDeepChildren(parentId, blocks) {
    const { truncated, deferred } = _splitDeepChildren(blocks, 2);
    if (deferred.length === 0) {
      return this._appendInBatches(parentId, truncated);
    }
    const createdIds = await this._appendInBatches(parentId, truncated);
    const byTop = new Map();
    for (const d of deferred) {
      if (!byTop.has(d.topIndex)) byTop.set(d.topIndex, []);
      byTop.get(d.topIndex).push(d);
    }
    for (const [topIdx, entries] of byTop) {
      const parentBlockId = createdIds[topIdx];
      const children = await this._fetchBlocksShallow(parentBlockId);
      for (const { childIndex, children: deepChildren } of entries) {
        await this._appendWithDeepChildren(children[childIndex].id, deepChildren);
      }
    }
    return createdIds;
  },

  async _appendAtPositionWithDeepChildren(parentId, blocks, position) {
    const { truncated, deferred } = _splitDeepChildren(blocks, 2);
    const createdIds = await this._appendAtPosition(parentId, truncated, position);
    if (deferred.length === 0) return createdIds;
    const byTop = new Map();
    for (const d of deferred) {
      if (!byTop.has(d.topIndex)) byTop.set(d.topIndex, []);
      byTop.get(d.topIndex).push(d);
    }
    for (const [topIdx, entries] of byTop) {
      const parentBlockId = createdIds[topIdx];
      const children = await this._fetchBlocksShallow(parentBlockId);
      for (const { childIndex, children: deepChildren } of entries) {
        await this._appendWithDeepChildren(children[childIndex].id, deepChildren);
      }
    }
    return createdIds;
  },

  async _appendAtPosition(pageId, blocks, position) {
    const nid = normalizeId(pageId);
    const createdIds = [];
    let pos = position || { type: "end" };
    for (let i = 0; i < blocks.length; i += 100) {
      const chunk = blocks.slice(i, i + 100);
      try {
        const resp = await this._call(() =>
          this.client.blocks.children.append({ block_id: nid, children: chunk, position: pos }),
        );
        const ids = resp.results.map((r) => r.id);
        createdIds.push(...ids);
        if (ids.length > 0) {
          pos = { type: "after_block", after_block: { id: ids[ids.length - 1] } };
        }
      } catch (e) {
        if (pos.type === "after_block") {
          pos = { type: "end" };
          const resp = await this._call(() =>
            this.client.blocks.children.append({ block_id: nid, children: chunk, position: pos }),
          );
          const ids = resp.results.map((r) => r.id);
          createdIds.push(...ids);
          if (ids.length > 0) {
            pos = { type: "after_block", after_block: { id: ids[ids.length - 1] } };
          }
        } else {
          throw e;
        }
      }
    }
    return createdIds;
  },
};
