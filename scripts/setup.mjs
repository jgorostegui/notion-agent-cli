#!/usr/bin/env node

/**
 * Notion Agent CLI — Setup
 * Validates token against Notion API. Does not write files.
 *
 * Usage:
 *   node scripts/setup.mjs --status                          # check current auth
 *   NOTION_TOKEN=ntn_xxx node scripts/setup.mjs --status     # validate a specific token
 *   printf '%s\n' "ntn_xxx" | node scripts/setup.mjs --with-token  # validate from stdin
 *   node scripts/setup.mjs                                   # interactive prompt + validate
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = process.env.CLAUDE_PLUGIN_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function loadExistingToken() {
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN;
  try {
    const env = await readFile(join(root, ".env"), "utf-8");
    const match = env.match(/^NOTION_TOKEN=(.+)$/m);
    if (match) return match[1].trim();
  } catch {}
  return null;
}

async function testToken(token) {
  const { Client } = await import("@notionhq/client");
  const client = new Client({ auth: token, notionVersion: "2025-09-03" });
  return client.users.me({});
}

async function status() {
  const token = await loadExistingToken();
  if (!token) {
    console.log("Not authenticated.");
    process.exit(1);
  }
  try {
    const me = await testToken(token);
    console.log(`Authenticated: ${me.name || me.id} (${me.type})`);
  } catch (e) {
    console.log(`Token found but invalid: ${e.message}`);
    process.exit(1);
  }
}

async function validate(token) {
  token = token.trim();
  if (!token.startsWith("ntn_")) {
    console.error("Invalid token format. Must start with 'ntn_'.");
    process.exit(1);
  }
  console.log("Testing connection...");
  try {
    const me = await testToken(token);
    console.log(`Connected as: ${me.name || me.id} (${me.type})`);
    console.log("Add NOTION_TOKEN to ~/.claude/settings.json env block to persist.");
  } catch (e) {
    console.error(`Connection failed: ${e.message}`);
    process.exit(1);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function interactive() {
  const existing = await loadExistingToken();
  if (existing) {
    try {
      const me = await testToken(existing);
      console.log(`Already authenticated: ${me.name || me.id} (${me.type})`);
      return;
    } catch {
      console.log("Stored token is invalid. Enter a new token.\n");
    }
  }

  if (!process.stdin.isTTY) {
    console.error("No token provided. Run interactively or pipe a token to --with-token.");
    process.exit(1);
  }

  console.log("\nNotion Agent CLI Setup\n");
  console.log("Create a Notion integration token at:");
  console.log("https://www.notion.so/profile/integrations\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const token = await new Promise((r) => rl.question("Notion token: ", r));
  rl.close();

  await validate(token);
}

const args = process.argv.slice(2);

if (args.includes("--status")) {
  status().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (args.includes("--with-token")) {
  readStdin()
    .then((token) => validate(token))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
} else {
  interactive().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
