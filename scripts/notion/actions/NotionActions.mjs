import { Client } from "@notionhq/client";
import { ConcurrencyLimiter } from "../limiter.mjs";
import { analysisMethods } from "./analysis.mjs";
import { batchMethods } from "./batch.mjs";
import { internalMethods } from "./internal.mjs";
import { readMethods } from "./read.mjs";
import { safetyMethods } from "./safety.mjs";
import { structuralMethods } from "./structural.mjs";
import { writeMethods } from "./write.mjs";

export class NotionActions {
  constructor(token) {
    const t = token || process.env.NOTION_TOKEN;
    if (!t)
      throw new Error("Notion token required. Run /notion-agent-cli:setup or set NOTION_TOKEN in the environment.");
    this.client = new Client({ auth: t, notionVersion: "2025-09-03", retry: { maxRetries: 3 } });
    this._limiter = new ConcurrencyLimiter(1);
    this._snapshots = new Map();
    this._dsCache = new Map();
    this._verbose = !!(process.env.DEBUG || process.env.VERBOSE);
    this._apiCallCount = 0;
  }
}

Object.assign(
  NotionActions.prototype,
  internalMethods,
  readMethods,
  writeMethods,
  structuralMethods,
  batchMethods,
  safetyMethods,
  analysisMethods,
);
