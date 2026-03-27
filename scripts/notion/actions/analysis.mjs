import { blocksToMarkdown } from "../converters/blocks.mjs";
import { normalizeId } from "../helpers/ids.mjs";
import { extractTitle } from "../helpers/properties.mjs";

export const analysisMethods = {
  async workspaceMap() {
    const pages = await this.search("", { type: "page" });
    const databases = await this.search("", { type: "data_source" });
    return { pages, databases, totalPages: pages.length, totalDatabases: databases.length };
  },

  async pageStats(pageId) {
    const nid = normalizeId(pageId);
    const page = await this._call(() => this.client.pages.retrieve({ page_id: nid }));
    const blocks = await this._fetchBlocksRecursive(nid);
    const md = blocksToMarkdown(blocks);
    const { count, maxDepth } = this._countBlocks(blocks);
    return {
      pageId: nid,
      title: extractTitle(page),
      blockCount: count,
      maxDepth,
      wordCount: md.split(/\s+/).filter(Boolean).length,
      lastEdited: page.last_edited_time,
      created: page.created_time,
    };
  },

  async diffPages(pageId1, pageId2) {
    const [md1, md2] = await Promise.all([this.getPage(normalizeId(pageId1)), this.getPage(normalizeId(pageId2))]);
    const lines1 = md1.split("\n").filter((l) => l.trim());
    const lines2 = md2.split("\n").filter((l) => l.trim());
    const set1 = new Set(lines1);
    const set2 = new Set(lines2);
    const common = lines1.filter((l) => set2.has(l));
    return {
      onlyInFirst: lines1.filter((l) => !set2.has(l)),
      onlyInSecond: lines2.filter((l) => !set1.has(l)),
      common,
      stats: { page1Lines: lines1.length, page2Lines: lines2.length, commonLines: common.length },
    };
  },

  async findDuplicates() {
    const { pages } = await this.workspaceMap();
    const groups = {};
    for (const p of pages) {
      const key = p.title.toLowerCase().trim();
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return Object.entries(groups)
      .filter(([, pages]) => pages.length > 1)
      .map(([title, pages]) => ({ title, count: pages.length, pages }));
  },

  async findOrphans() {
    const { pages } = await this.workspaceMap();
    return pages.filter((p) => p.parent?.type === "workspace");
  },

  async findEmpty() {
    const { pages } = await this.workspaceMap();
    const empty = [];
    for (const p of pages.slice(0, 100)) {
      try {
        const blocks = await this._fetchBlocksShallow(p.id);
        if (blocks.length === 0) empty.push(p);
      } catch {
        /* skip inaccessible */
      }
    }
    return empty;
  },

  async findStale(days = 30) {
    const { pages } = await this.workspaceMap();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return pages.filter((p) => p.lastEdited && p.lastEdited < cutoff);
  },

  async suggestReorganization(pageId) {
    const nid = normalizeId(pageId);
    const tree = await this.getTree(nid, { depth: 5 });
    const stats = await this.pageStats(nid);
    const suggestions = [];
    const checkDepth = (node, depth = 0) => {
      if (depth > 3)
        suggestions.push({
          type: "too_deep",
          message: `"${node.title}" is nested ${depth} levels deep`,
          pageId: node.id,
        });
      for (const child of node.children || []) checkDepth(child, depth + 1);
    };
    checkDepth(tree);
    const checkWidth = (node) => {
      if ((node.children?.length || 0) > 10)
        suggestions.push({
          type: "too_wide",
          message: `"${node.title}" has ${node.children.length} children`,
          pageId: node.id,
        });
      for (const child of node.children || []) checkWidth(child);
    };
    checkWidth(tree);
    if (stats.wordCount > 3000)
      suggestions.push({ type: "too_long", message: `Page has ${stats.wordCount} words`, pageId: nid });
    if (stats.blockCount > 200)
      suggestions.push({ type: "many_blocks", message: `Page has ${stats.blockCount} blocks`, pageId: nid });
    return { tree, stats, suggestions, suggestionCount: suggestions.length };
  },

  _countBlocks(blocks, depth = 0) {
    let count = blocks.length;
    let maxDepth = depth;
    for (const b of blocks) {
      if (b.children?.length) {
        const sub = this._countBlocks(b.children, depth + 1);
        count += sub.count;
        maxDepth = Math.max(maxDepth, sub.maxDepth);
      }
    }
    return { count, maxDepth };
  },
};
