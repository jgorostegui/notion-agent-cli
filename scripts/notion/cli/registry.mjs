/** Explicit action registry — no signature introspection */
export const ACTIONS = {
  // READ
  search: { args: ["query"], options: ["type"] },
  getPage: { args: ["pageId"], options: ["format"] },
  getDatabase: { args: ["dbId"], options: [] },
  queryDatabase: { args: ["dbId"], options: ["filter", "sorts", "limit", "format"] },
  getTree: { args: ["pageId"], options: ["depth"] },
  exportPage: { args: ["pageId", "path"], options: [] },
  exportDatabase: { args: ["dbId", "path"], options: ["format"] },
  getComments: { args: ["pageId"], options: [] },
  getUsers: { args: [], options: [] },
  // WRITE
  createPage: { args: ["parentId", "title", "content"], options: ["parentType"] },
  updatePage: { args: ["pageId", "content"], options: [] },
  appendBlocks: { args: ["pageId", "content"], options: [] },
  insertBlocks: { args: ["pageId", "content"], options: ["after", "atHeading", "atStart"] },
  setProperties: { args: ["pageId", "props"], options: [] },
  addComment: { args: ["pageId", "text"], options: [] },
  lockPage: { args: ["pageId"], options: [] },
  unlockPage: { args: ["pageId"], options: [] },
  createDatabase: { args: ["parentId", "title", "schema"], options: [] },
  addDatabaseEntry: { args: ["dbId", "values"], options: [] },
  importTable: { args: ["parentId", "content"], options: ["title"] },
  // STRUCTURAL
  moveBlocks: { args: ["sourcePageId", "targetPageId", "blockIds"], options: ["position"] },
  movePage: { args: ["pageId", "newParentId"], options: ["parentType"] },
  reorderBlocks: { args: ["pageId", "newOrder"], options: [] },
  deepCopy: { args: ["sourcePageId", "targetParentId"], options: [] },
  copyPageWith: {
    args: ["sourcePageId", "targetParentId", "title"],
    options: ["appendMd", "prependMd", "replaceTitle"],
  },
  mergePages: { args: ["sourcePageIds", "targetPageId"], options: ["archiveSources"] },
  splitPage: { args: ["pageId"], options: ["headingLevel", "createUnderSamePage"] },
  extractSection: { args: ["pageId", "headingText"], options: [] },
  replaceSection: { args: ["pageId", "headingText", "content"], options: [] },
  flattenPage: { args: ["pageId"], options: [] },
  nestUnderHeadings: { args: ["pageId"], options: ["headingLevel"] },
  duplicateStructure: { args: ["sourcePageId", "targetParentId"], options: [] },
  applyTemplate: { args: ["templatePageId", "targetParentId", "variables"], options: [] },
  // BATCH
  batchSetProperties: { args: ["pageIds", "props"], options: [] },
  batchArchive: { args: ["pageIds"], options: [] },
  batchTag: { args: ["pageIds", "property", "value"], options: [] },
  // SAFETY
  snapshot: { args: ["pageId"], options: [] },
  restore: { args: ["snapId"], options: [] },
  backupPage: { args: ["pageId", "dirPath"], options: [] },
  backupDatabase: { args: ["dbId", "dirPath"], options: [] },
  transact: { args: ["operations"], options: [] },
  // ANALYSIS
  workspaceMap: { args: [], options: [] },
  pageStats: { args: ["pageId"], options: [] },
  diffPages: { args: ["pageId1", "pageId2"], options: [] },
  findDuplicates: { args: [], options: [] },
  findOrphans: { args: [], options: [] },
  findEmpty: { args: [], options: [] },
  findStale: { args: ["days"], options: [] },
  suggestReorganization: { args: ["pageId"], options: [] },
};

/** Convert snake_case to camelCase */
export function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Common action aliases — maps wrong names to correct ones */
export const ACTION_ALIASES = {
  readPage: "getPage",
  fetchPage: "getPage",
  read: "getPage",
  get: "getPage",
  updateProperties: "setProperties",
  updateProps: "setProperties",
  query: "queryDatabase",
  queryDb: "queryDatabase",
  copy: "deepCopy",
  copyPage: "deepCopy",
  merge: "mergePages",
  split: "splitPage",
  archive: "batchArchive",
  duplicate: "deepCopy",
  tableToDatabase: "importTable",
  createDatabaseFromTable: "importTable",
};

/** Resolve action name with alias fallback */
export function resolveAction(name) {
  const camel = toCamelCase(name);
  return ACTION_ALIASES[camel] || camel;
}
