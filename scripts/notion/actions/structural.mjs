import { _sanitizeBlockForCreate, blocksToMarkdown, recreateBlock } from "../converters/blocks.mjs";
import { _cloneRichTextArray, richTextToMd } from "../converters/rich-text.mjs";
import { _clonePageCover, _clonePageIcon } from "../helpers/clone.mjs";
import { normalizeId } from "../helpers/ids.mjs";
import { clonePropertyValue, extractTitle } from "../helpers/properties.mjs";

export const structuralMethods = {
  async moveBlocks(sourcePageId, targetPageId, blockIds, { position } = {}) {
    const srcId = normalizeId(sourcePageId);
    const tgtId = normalizeId(targetPageId);
    await this.snapshot(srcId);
    const created = [];
    try {
      let pos = position || { type: "end" };
      for (const blockId of blockIds) {
        const bid = normalizeId(blockId);
        const block = await this._call(() => this.client.blocks.retrieve({ block_id: bid }));
        let children = [];
        if (block.has_children) children = await this._fetchBlocksRecursive(bid);
        const newBlock = recreateBlock(block, children);
        if (!newBlock) continue;
        const resp = await this._call(() =>
          this.client.blocks.children.append({ block_id: tgtId, children: [newBlock], position: pos }),
        );
        const newId = resp.results?.[0]?.id;
        if (newId) {
          created.push(newId);
          pos = { type: "after_block", after_block: { id: newId } };
        }
        await this._call(() => this.client.blocks.delete({ block_id: bid }));
      }
      return { success: true, moved: created.length, newBlockIds: created };
    } catch (e) {
      for (const id of created) await this._call(() => this.client.blocks.delete({ block_id: id })).catch(() => {});
      return { success: false, error: String(e), rolledBack: true };
    }
  },

  async movePage(pageId, newParentId, { parentType: _parentType = "page" } = {}) {
    const nid = normalizeId(pageId);
    try {
      await this.snapshot(nid);
      const result = await this.deepCopy(nid, normalizeId(newParentId));
      if (!result.success) return result;
      await this._call(() => this.client.pages.update({ page_id: nid, archived: true }));
      return { success: true, newPageId: result.newPageId, originalArchived: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async reorderBlocks(pageId, newOrder) {
    const nid = normalizeId(pageId);
    try {
      await this.snapshot(nid);
      const blocks = await this._fetchBlocksRecursive(nid);
      const blockMap = new Map();
      for (const b of blocks) blockMap.set(b.id, b);
      const ordered = [];
      const used = new Set();
      for (const id of newOrder) {
        const noid = normalizeId(id);
        if (blockMap.has(noid)) {
          ordered.push(blockMap.get(noid));
          used.add(noid);
        }
      }
      for (const b of blocks) {
        if (!used.has(b.id)) ordered.push(b);
      }
      const shallow = await this._fetchBlocksShallow(nid);
      for (const block of shallow) {
        if (block.type === "child_page" || block.type === "child_database") continue;
        await this._call(() => this.client.blocks.delete({ block_id: block.id })).catch(() => {});
      }
      const recreated = ordered.map((b) => recreateBlock(b, b.children || [])).filter(Boolean);
      await this._appendWithDeepChildren(nid, recreated);
      return { success: true, reordered: newOrder.length };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deepCopy(sourcePageId, targetParentId) {
    const srcId = normalizeId(sourcePageId);
    const tgtId = normalizeId(targetParentId);
    try {
      const page = await this._call(() => this.client.pages.retrieve({ page_id: srcId }));
      let titleRt = [{ text: { content: "Untitled" } }];
      for (const prop of Object.values(page.properties || {})) {
        if (prop.type === "title" && prop.title?.length) {
          titleRt = _cloneRichTextArray(prop.title);
          break;
        }
      }
      const createPayload = {
        parent: { page_id: tgtId },
        properties: { title: titleRt },
      };
      let icon = _clonePageIcon(page.icon);
      if (!icon && page.icon?.type === "file" && page.icon.file?.url) {
        icon = await this._reuploadNotionFile(page.icon.file.url);
      }
      let cover = _clonePageCover(page.cover);
      if (!cover && page.cover?.type === "file" && page.cover.file?.url) {
        cover = await this._reuploadNotionFile(page.cover.file.url);
      }
      if (icon) createPayload.icon = icon;
      if (cover) createPayload.cover = cover;
      const newPage = await this._call(() => this.client.pages.create(createPayload));
      if (page.is_locked) {
        await this._call(() => this.client.pages.update({ page_id: newPage.id, is_locked: true })).catch(() => {});
      }
      try {
        const warnings = await this._deepCopyBlocks(srcId, newPage.id);
        if (page.icon && !icon)
          warnings.push({ type: "icon_skipped", reason: "Notion-hosted file icon requires re-upload" });
        if (page.cover && !cover)
          warnings.push({ type: "cover_skipped", reason: "Notion-hosted file cover requires re-upload" });
        const result = { success: true, newPageId: newPage.id };
        if (warnings.length > 0) result.warnings = warnings;
        return result;
      } catch (contentError) {
        try {
          await this._call(() => this.client.pages.update({ page_id: newPage.id, archived: true }));
        } catch {
          /* best effort */
        }
        return { success: false, error: `Content copy failed (page archived): ${contentError}` };
      }
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async _deepCopyBlocks(sourceId, targetId) {
    const MEDIA_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);
    const INLINE_CHILDREN_TYPES = new Set(["table", "column_list"]);
    const blocks = await this._fetchBlocksShallow(sourceId);
    const tgtId = normalizeId(targetId);
    const warnings = [];
    let batch = [];
    let batchSources = [];

    const flushBatch = async () => {
      if (batch.length === 0) return;
      try {
        const resp = await this._call(() => this.client.blocks.children.append({ block_id: tgtId, children: batch }));
        for (let i = 0; i < batchSources.length; i++) {
          if (batchSources[i].has_children && resp.results[i]?.id) {
            const childWarnings = await this._deepCopyBlocks(batchSources[i].id, resp.results[i].id);
            warnings.push(...childWarnings);
          }
        }
      } catch (e) {
        warnings.push({ type: "batch_append_failed", blockCount: batch.length, error: String(e) });
      }
      batch = [];
      batchSources = [];
    };

    for (const block of blocks) {
      if (block.type === "child_page") {
        await flushBatch();
        const result = await this.deepCopy(block.id, tgtId);
        if (!result.success) {
          warnings.push({ type: "child_page", sourceId: block.id, error: result.error });
        } else if (result.warnings) {
          warnings.push(...result.warnings);
        }
      } else if (block.type === "child_database") {
        await flushBatch();
        const result = await this._cloneDatabase(block.id, tgtId);
        if (!result.success) {
          warnings.push({ type: "child_database", sourceId: block.id, error: result.error });
        } else if (result.errors?.length) {
          for (const e of result.errors) {
            warnings.push({ type: "child_database_row", databaseId: result.databaseId, ...e });
          }
        }
      } else {
        let cloned;
        let blockForRecursion = block;
        if (INLINE_CHILDREN_TYPES.has(block.type) && block.has_children) {
          const inlineChildren = await this._fetchBlocksShallow(block.id);
          const clonedChildren = [];
          for (const c of inlineChildren) {
            if (c.type === "column" && c.has_children) {
              const colContent = await this._fetchBlocksShallow(c.id);
              const clonedColContent = [];
              for (const cc of colContent) {
                if (cc.type === "table" && cc.has_children) {
                  const tableRows = await this._fetchBlocksShallow(cc.id);
                  const clonedRows = tableRows
                    .map((r) => _sanitizeBlockForCreate(recreateBlock(r, [])))
                    .filter(Boolean);
                  const tb = _sanitizeBlockForCreate(recreateBlock(cc, clonedRows));
                  if (tb) clonedColContent.push(tb);
                } else if (MEDIA_TYPES.has(cc.type) && cc[cc.type]?.type === "file" && cc[cc.type]?.file?.url) {
                  const uploaded = await this._reuploadNotionFile(cc[cc.type].file.url);
                  if (uploaded) {
                    const mediaBlock = _sanitizeBlockForCreate(recreateBlock(cc, []));
                    if (mediaBlock) {
                      mediaBlock[cc.type] = { type: "file_upload", file_upload: { id: uploaded.file_upload.id } };
                      if (cc[cc.type].caption?.length) mediaBlock[cc.type].caption = cc[cc.type].caption;
                      clonedColContent.push(mediaBlock);
                    }
                  } else {
                    warnings.push({ type: "media_upload_failed", blockType: cc.type, sourceId: cc.id });
                  }
                } else if (
                  MEDIA_TYPES.has(cc.type) &&
                  cc[cc.type]?.type === "external" &&
                  !(cc[cc.type]?.external?.url || "").startsWith("http")
                ) {
                  warnings.push({ type: "invalid_media_url_skipped", blockType: cc.type, sourceId: cc.id });
                } else {
                  const cb = _sanitizeBlockForCreate(recreateBlock(cc, []));
                  if (cb) clonedColContent.push(cb);
                }
              }
              const colBlock = _sanitizeBlockForCreate(recreateBlock(c, clonedColContent));
              if (colBlock) clonedChildren.push(colBlock);
            } else {
              const cc = _sanitizeBlockForCreate(recreateBlock(c, []));
              if (cc) clonedChildren.push(cc);
            }
          }
          cloned = _sanitizeBlockForCreate(recreateBlock(block, clonedChildren));
          blockForRecursion = { ...block, has_children: false };
        } else {
          cloned = _sanitizeBlockForCreate(recreateBlock(block, []));
        }
        if (!cloned) continue;
        if (MEDIA_TYPES.has(block.type) && cloned[block.type]?.type === "external") {
          const extUrl = cloned[block.type].external?.url || "";
          if (!extUrl.startsWith("https://") && !extUrl.startsWith("http://")) {
            warnings.push({
              type: "invalid_media_url_skipped",
              blockType: block.type,
              sourceId: block.id,
              url: extUrl.substring(0, 80),
            });
            continue;
          }
        }
        if (MEDIA_TYPES.has(block.type) && block[block.type]?.type === "file" && block[block.type]?.file?.url) {
          await flushBatch();
          const uploaded = await this._reuploadNotionFile(block[block.type].file.url);
          if (!uploaded) {
            warnings.push({ type: "media_upload_failed", blockType: block.type, sourceId: block.id });
            continue;
          }
          cloned[block.type] = { type: "file_upload", file_upload: { id: uploaded.file_upload.id } };
          const origContent = block[block.type];
          if (origContent.caption?.length) cloned[block.type].caption = origContent.caption;
          try {
            await this._call(() => this.client.blocks.children.append({ block_id: tgtId, children: [cloned] }));
          } catch (e) {
            warnings.push({ type: "media_append_failed", blockType: block.type, sourceId: block.id, error: String(e) });
          }
          continue;
        }
        batch.push(cloned);
        batchSources.push(blockForRecursion);
        if (batch.length >= 100) await flushBatch();
      }
    }
    await flushBatch();
    return warnings;
  },

  async _cloneDatabase(sourceDbId, targetParentId) {
    const srcId = normalizeId(sourceDbId);
    const tgtId = normalizeId(targetParentId);
    try {
      const db = await this._call(() => this.client.databases.retrieve({ database_id: srcId }));
      if (!db.data_sources?.length) {
        const createPayload = {
          parent: { type: "page_id", page_id: tgtId },
          title: db.title?.length ? _cloneRichTextArray(db.title) : [{ text: { content: "" } }],
          initial_data_source: { properties: {} },
        };
        if (db.description?.length) createPayload.description = _cloneRichTextArray(db.description);
        let emptyIcon = _clonePageIcon(db.icon);
        if (!emptyIcon && db.icon?.type === "file" && db.icon.file?.url) {
          emptyIcon = await this._reuploadNotionFile(db.icon.file.url);
        }
        if (emptyIcon) createPayload.icon = emptyIcon;
        let emptyCover = _clonePageCover(db.cover);
        if (!emptyCover && db.cover?.type === "file" && db.cover.file?.url) {
          emptyCover = await this._reuploadNotionFile(db.cover.file.url);
        }
        if (emptyCover) createPayload.cover = emptyCover;
        if (db.is_inline) createPayload.is_inline = true;
        const newDb = await this._call(() => this.client.databases.create(createPayload));
        return {
          success: true,
          databaseId: newDb.id,
          url: newDb.url,
          entriesCloned: 0,
          rowIdMap: new Map(),
          errors: [],
        };
      }
      const dsId = await this._resolveDataSourceId(srcId);
      const ds = await this._call(() => this.client.dataSources.retrieve({ data_source_id: dsId }));
      const SKIP_SCHEMA_TYPES = new Set([
        "formula",
        "rollup",
        "created_time",
        "created_by",
        "last_edited_time",
        "last_edited_by",
        "unique_id",
      ]);
      const schema = {};
      const cloneableProps = [];
      for (const [name, prop] of Object.entries(ds.properties || {})) {
        if (SKIP_SCHEMA_TYPES.has(prop.type)) continue;
        schema[name] = { [prop.type]: prop[prop.type] || {} };
        cloneableProps.push([name, prop.type]);
      }
      const createPayload = {
        parent: { type: "page_id", page_id: tgtId },
        title: db.title?.length ? _cloneRichTextArray(db.title) : [{ text: { content: "" } }],
        initial_data_source: { properties: schema },
      };
      if (db.description?.length) createPayload.description = _cloneRichTextArray(db.description);
      let dbIcon = _clonePageIcon(db.icon);
      if (!dbIcon && db.icon?.type === "file" && db.icon.file?.url) {
        dbIcon = await this._reuploadNotionFile(db.icon.file.url);
      }
      if (dbIcon) createPayload.icon = dbIcon;
      let dbCover = _clonePageCover(db.cover);
      if (!dbCover && db.cover?.type === "file" && db.cover.file?.url) {
        dbCover = await this._reuploadNotionFile(db.cover.file.url);
      }
      if (dbCover) createPayload.cover = dbCover;
      if (db.is_inline) createPayload.is_inline = true;
      const newDb = await this._call(() => this.client.databases.create(createPayload));
      const entries = await this._paginateQuery(dsId);
      const newDsId = await this._resolveDataSourceId(newDb.id);
      const rowTasks = entries.map((entry) => () => {
        const properties = {};
        for (const [name] of cloneableProps) {
          const prop = entry.properties?.[name];
          if (!prop || SKIP_SCHEMA_TYPES.has(prop.type)) continue;
          if (prop.type === "relation" || prop.type === "files") continue;
          const cloned = clonePropertyValue(prop);
          if (cloned) properties[name] = cloned;
        }
        return this.client.pages.create({ parent: { data_source_id: newDsId }, properties });
      });
      const rowResults = await this._callBatch(rowTasks, 5);
      const rowIdMap = new Map();
      let created = 0;
      const errors = [];
      for (let i = 0; i < rowResults.length; i++) {
        if (rowResults[i].ok) {
          rowIdMap.set(entries[i].id, rowResults[i].value.id);
          created++;
        } else {
          errors.push({ error: String(rowResults[i].error) });
        }
      }
      for (const [oldId, newId] of rowIdMap) {
        try {
          await this._deepCopyBlocks(oldId, newId);
        } catch (e) {
          errors.push({ error: `Row body copy failed: ${e}` });
        }
      }
      return { success: true, databaseId: newDb.id, url: newDb.url, entriesCloned: created, rowIdMap, errors };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async copyPageWith(sourcePageId, targetParentId, title, { appendMd, prependMd, replaceTitle } = {}) {
    const srcId = normalizeId(sourcePageId);
    const tgtId = normalizeId(targetParentId);
    try {
      const md = await this.getPage(srcId);
      const firstNewlines = md.indexOf("\n\n");
      let contentMd = firstNewlines >= 0 ? md.slice(firstNewlines + 2) : md;
      if (prependMd) contentMd = `${prependMd}\n\n${contentMd}`;
      if (appendMd) contentMd = `${contentMd}\n\n${appendMd}`;
      const finalTitle = replaceTitle || title;
      const result = await this.createPage(tgtId, finalTitle, contentMd);
      return result;
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async mergePages(sourcePageIds, targetPageId, { archiveSources = false } = {}) {
    const tgtId = normalizeId(targetPageId);
    try {
      await this.snapshot(tgtId);
      let merged = 0;
      for (const srcId of sourcePageIds) {
        const md = await this.getPage(normalizeId(srcId));
        const sectionMd = md.startsWith("# ") ? `##${md.slice(1)}` : md;
        await this.appendBlocks(tgtId, sectionMd);
        merged++;
        if (archiveSources) {
          await this._call(() => this.client.pages.update({ page_id: normalizeId(srcId), archived: true }));
        }
      }
      return { success: true, merged, total: sourcePageIds.length };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async splitPage(pageId, { headingLevel = 2, createUnderSamePage = false } = {}) {
    const nid = normalizeId(pageId);
    try {
      const md = await this.getPage(nid);
      const page = await this._call(() => this.client.pages.retrieve({ page_id: nid }));
      const parentId = createUnderSamePage ? nid : page.parent?.page_id || nid;
      const headingPrefix = `${"#".repeat(headingLevel)} `;
      const regex = new RegExp(`\n(?=${headingPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`);
      const sections = md.split(regex);
      const created = [];
      for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;
        const titleMatch = trimmed.match(/^#{1,3}\s+(.*)/);
        const title = titleMatch ? titleMatch[1] : "Untitled Section";
        const content = titleMatch ? trimmed.replace(/^#{1,3}\s+.*\n?/, "") : trimmed;
        const result = await this.createPage(parentId, title, content.trim());
        if (result.success) created.push(result.pageId);
      }
      return { success: true, pagesCreated: created.length, pageIds: created };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async extractSection(pageId, headingText) {
    const nid = normalizeId(pageId);
    try {
      const blocks = await this._fetchBlocksShallow(nid);
      const sectionBlocks = [];
      let capturing = false;
      let captureLevel = 0;
      for (const block of blocks) {
        const type = block.type;
        if (type?.startsWith("heading_")) {
          const level = parseInt(type.split("_")[1], 10);
          const text = richTextToMd(block[type]?.rich_text);
          if (!capturing && text.toLowerCase().includes(headingText.toLowerCase())) {
            capturing = true;
            captureLevel = level;
            sectionBlocks.push(block);
            continue;
          } else if (capturing && level <= captureLevel) {
            break;
          }
        }
        if (capturing) {
          if (block.has_children && block.type !== "child_page" && block.type !== "child_database") {
            block.children = await this._fetchBlocksRecursive(block.id);
          }
          sectionBlocks.push(block);
        }
      }
      if (!sectionBlocks.length) return { success: false, error: `Section "${headingText}" not found` };
      return { success: true, markdown: blocksToMarkdown(sectionBlocks), blockIds: sectionBlocks.map((b) => b.id) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async replaceSection(pageId, headingText, newContentMd) {
    const nid = normalizeId(pageId);
    try {
      await this.snapshot(nid);
      const blocks = await this._fetchBlocksShallow(nid);
      let headingBlockId = null;
      let headingLevel = 0;
      const blocksToDelete = [];
      let pastHeading = false;
      for (const block of blocks) {
        const type = block.type;
        if (type?.startsWith("heading_")) {
          const level = parseInt(type.split("_")[1], 10);
          const text = richTextToMd(block[type]?.rich_text);
          if (!pastHeading && text.toLowerCase().includes(headingText.toLowerCase())) {
            headingBlockId = block.id;
            headingLevel = level;
            pastHeading = true;
            continue;
          } else if (pastHeading && level <= headingLevel) {
            break;
          }
        }
        if (pastHeading) blocksToDelete.push(block.id);
      }
      if (!headingBlockId) return { success: false, error: `Section "${headingText}" not found` };
      for (const id of blocksToDelete) {
        await this._call(() => this.client.blocks.delete({ block_id: id })).catch(() => {});
      }
      return this.insertBlocks(nid, newContentMd, { after: headingBlockId });
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async flattenPage(pageId) {
    const nid = normalizeId(pageId);
    try {
      await this.snapshot(nid);
      const blocks = await this._fetchBlocksShallow(nid);
      let flattened = 0;
      for (const block of blocks) {
        if (block.type === "child_page") {
          const subMd = await this.getPage(block.id);
          const sectionMd = subMd.replace(/^# (.*)/, "## $1");
          await this.insertBlocks(nid, sectionMd, { after: block.id });
          await this._call(() => this.client.pages.update({ page_id: block.id, archived: true }));
          await this._call(() => this.client.blocks.delete({ block_id: block.id })).catch(() => {});
          flattened++;
        }
      }
      return { success: true, flattenedSubpages: flattened };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async nestUnderHeadings(pageId, { headingLevel = 2 } = {}) {
    const nid = normalizeId(pageId);
    try {
      await this.snapshot(nid);
      const result = await this.splitPage(nid, { headingLevel, createUnderSamePage: true });
      if (!result.success) return result;
      const blocks = await this._fetchBlocksShallow(nid);
      let hitFirstHeading = false;
      for (const block of blocks) {
        if (block.type === "child_page") continue;
        if (block.type?.startsWith("heading_")) hitFirstHeading = true;
        if (hitFirstHeading) {
          await this._call(() => this.client.blocks.delete({ block_id: block.id })).catch(() => {});
        }
      }
      return { success: true, pagesCreated: result.pagesCreated, pageIds: result.pageIds };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async duplicateStructure(sourcePageId, targetParentId) {
    const srcId = normalizeId(sourcePageId);
    const tgtId = normalizeId(targetParentId);
    try {
      const tree = await this.getTree(srcId, { depth: 10 });
      const copyTree = async (node, parentId) => {
        const result = await this.createPage(parentId, node.title);
        if (!result.success) return;
        for (const child of node.children || []) {
          if (child.type === "page") await copyTree(child, result.pageId);
        }
      };
      await copyTree(tree, tgtId);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async applyTemplate(templatePageId, targetParentId, variables = {}) {
    const srcId = normalizeId(templatePageId);
    const tgtId = normalizeId(targetParentId);
    try {
      let md = await this.getPage(srcId);
      const page = await this._call(() => this.client.pages.retrieve({ page_id: srcId }));
      let title = extractTitle(page);
      for (const [key, value] of Object.entries(variables)) {
        const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
        md = md.replace(pattern, value);
        title = title.replace(pattern, value);
      }
      const firstNewlines = md.indexOf("\n\n");
      const contentMd = firstNewlines >= 0 ? md.slice(firstNewlines + 2) : md;
      return this.createPage(tgtId, title, contentMd);
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};
