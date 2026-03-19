#!/usr/bin/env node
/**
 * Notion Actions — Interactive Setup
 * Prompts for token, validates format, tests connection, writes .env
 */

import { createInterface } from "readline";
import { writeFile } from "fs/promises";
import { Client } from "@notionhq/client";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function setup() {
  console.log("\n🔧 Notion Actions Setup\n");
  console.log("You need a Notion integration token.");
  console.log("Create one at: https://www.notion.so/profile/integrations\n");

  const token = await ask("Enter your Notion token: ");

  if (!token.startsWith("ntn_")) {
    console.error("\n❌ Invalid token format. Must start with 'ntn_'.");
    rl.close();
    process.exit(1);
  }

  console.log("\nTesting connection...");
  try {
    const client = new Client({ auth: token, notionVersion: "2025-09-03" });
    const me = await client.users.me({});
    console.log(`✅ Connected as: ${me.name || me.id} (${me.type})`);
  } catch (e) {
    console.error(`\n❌ Connection failed: ${e.message}`);
    rl.close();
    process.exit(1);
  }

  await writeFile(".env", `NOTION_TOKEN=${token}\n`, "utf-8");
  console.log("\n✅ Token saved to .env");
  console.log("Remember to share your Notion pages with the integration.\n");
  rl.close();
}

setup().catch(e => { console.error(e); process.exit(1); });
