#!/usr/bin/env node

/**
 * Notion Agent CLI — Setup
 * Installs runtime deps if needed, validates token, writes plugin-root .env
 *
 * Usage:
 *   node scripts/setup.mjs                         # install deps + secure prompt
 *   printf '%s\n' "ntn_xxx" | node scripts/setup.mjs --with-token
 *   node scripts/setup.mjs --status
 */

import { execFileSync, spawnSync } from "node:child_process";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = process.env.CLAUDE_PLUGIN_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");

function fileExists(path) {
  return access(path)
    .then(() => true)
    .catch(() => false);
}

async function hasRuntimeDeps() {
  return fileExists(join(root, "node_modules", "@notionhq", "client"));
}

async function ensureDependencies() {
  if (await hasRuntimeDeps()) return;

  const hasLockfile = await fileExists(join(root, "package-lock.json"));
  const args = hasLockfile
    ? ["ci", "--omit=dev", "--no-fund", "--no-audit", "--loglevel=error"]
    : ["install", "--omit=dev", "--no-fund", "--no-audit", "--loglevel=error"];

  console.log("Installing plugin dependencies...");
  const result = spawnSync("npm", args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0 || !(await hasRuntimeDeps())) {
    throw new Error("Dependency installation failed.");
  }
}

let ClientClass = null;

async function getClientClass() {
  if (ClientClass) return ClientClass;
  await ensureDependencies();
  ({ Client: ClientClass } = await import("@notionhq/client"));
  return ClientClass;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function readStdinIfPiped() {
  if (process.stdin.isTTY) return "";
  return readStdin();
}

async function ask(question, { hidden = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let echoDisabled = false;

  try {
    if (hidden && process.stdin.isTTY && process.platform !== "win32") {
      execFileSync("stty", ["-echo"], { stdio: "inherit" });
      echoDisabled = true;
    }

    const answer = await new Promise((resolve) => rl.question(question, resolve));
    if (echoDisabled) process.stdout.write("\n");
    return answer;
  } finally {
    rl.close();
    if (echoDisabled) {
      try {
        execFileSync("stty", ["echo"], { stdio: "inherit" });
      } catch {}
    }
  }
}

async function promptForToken() {
  console.log("\nNotion Agent CLI Setup\n");
  console.log("Create a Notion integration token at:");
  console.log("https://www.notion.so/profile/integrations\n");
  console.log("Paste the token when prompted. Input is hidden when supported.\n");
  return ask("Notion token: ", { hidden: true });
}

async function loadExistingToken() {
  // Check env var first
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN;
  // Then .env file
  try {
    const env = await readFile(envPath, "utf-8");
    const match = env.match(/^NOTION_TOKEN=(.+)$/m);
    if (match) return match[1].trim();
  } catch {}
  return null;
}

async function testToken(token) {
  const Client = await getClientClass();
  const client = new Client({ auth: token, notionVersion: "2025-09-03" });
  return client.users.me({});
}

async function status() {
  await ensureDependencies();
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

async function resolveTokenInput() {
  const piped = await readStdinIfPiped();
  if (piped) return piped;

  if (process.stdin.isTTY && process.stdout.isTTY) {
    return promptForToken();
  }

  throw new Error("No token provided. Run interactively or pipe a token to --with-token.");
}

async function setup(token) {
  await ensureDependencies();

  if (!token) {
    const existing = await loadExistingToken();
    if (existing) {
      try {
        const me = await testToken(existing);
        console.log(`Already authenticated: ${me.name || me.id} (${me.type})`);
        console.log(`Config path: ${envPath}`);
        return;
      } catch {
        console.log("Stored token is invalid. Enter a new token.\n");
      }
    }

    token = await resolveTokenInput();
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

  await mkdir(dirname(envPath), { recursive: true }).catch(() => {});
  await writeFile(envPath, `NOTION_TOKEN=${token}\n`, "utf-8");
  await chmod(envPath, 0o600).catch(() => {});
  console.log(`Token saved to ${envPath}`);
  console.log("Remember to share your Notion pages with the integration.");
}

const args = process.argv.slice(2);

if (args.includes("--status")) {
  status().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (args.includes("--with-token")) {
  resolveTokenInput()
    .then((token) => setup(token))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
} else {
  setup().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
