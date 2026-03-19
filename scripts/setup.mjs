#!/usr/bin/env node
/**
 * Notion Agent CLI — Setup
 * Validates token, tests connection, writes .env
 *
 * Usage:
 *   node setup.mjs                              # interactive prompt
 *   echo "ntn_xxx" | node setup.mjs --with-token  # stdin (agent-friendly, no process list leak)
 *   node setup.mjs --status                     # check current auth
 */

import { createInterface } from "readline";
import { writeFile, mkdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { Client } from "@notionhq/client";

const root = process.env.CLAUDE_PLUGIN_ROOT || process.cwd();

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function loadExistingToken() {
  // Check env var first
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN;
  // Then .env file
  try {
    const env = await readFile(join(root, ".env"), "utf-8");
    const match = env.match(/^NOTION_TOKEN=(.+)$/m);
    if (match) return match[1].trim();
  } catch {}
  return null;
}

async function testToken(token) {
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

async function setup(token) {
  if (!token) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));
    console.log("\nNotion Agent CLI Setup\n");
    console.log("You need a Notion integration token.");
    console.log("Create one at: https://www.notion.so/profile/integrations\n");
    token = await ask("Enter your Notion token: ");
    rl.close();
  }

  token = token.trim();
  if (!token.startsWith("ntn_")) {
    console.error("Invalid token format. Must start with 'ntn_'.");
    process.exit(1);
  }

  console.log("Testing connection...");
  try {
    const me = await testToken(token);
    console.log(`Connected as: ${me.name || me.id} (${me.type})`);
  } catch (e) {
    console.error(`Connection failed: ${e.message}`);
    process.exit(1);
  }

  const envPath = join(root, ".env");
  await mkdir(dirname(envPath), { recursive: true }).catch(() => {});
  await writeFile(envPath, `NOTION_TOKEN=${token}\n`, "utf-8");
  console.log(`Token saved to ${envPath}`);
  console.log("Remember to share your Notion pages with the integration.");
}

const args = process.argv.slice(2);

if (args.includes("--status")) {
  status().catch(e => { console.error(e); process.exit(1); });
} else if (args.includes("--with-token")) {
  readStdin().then(token => setup(token)).catch(e => { console.error(e); process.exit(1); });
} else {
  setup().catch(e => { console.error(e); process.exit(1); });
}
