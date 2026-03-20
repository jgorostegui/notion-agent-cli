#!/usr/bin/env node
/**
 * Bump version in package.json and .claude-plugin/plugin.json,
 * commit the change, and create a git tag.
 *
 * Usage:
 *   npm run bump              # patch: 0.1.0 → 0.1.1
 *   npm run bump -- minor     # minor: 0.1.0 → 0.2.0
 *   npm run bump -- major     # major: 0.1.0 → 1.0.0
 *   npm run bump -- 2.3.4     # explicit version
 *   npm run bump -- patch --no-tag   # bump without git tag
 */

import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  join(root, "package.json"),
  join(root, ".claude-plugin", "plugin.json"),
];

const args = process.argv.slice(2);
const noTag = args.includes("--no-tag");
const arg = args.find((a) => a !== "--no-tag") || "patch";

function bump(current, type) {
  const [major, minor, patch] = current.split(".").map(Number);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  if (type === "patch") return `${major}.${minor}.${patch + 1}`;
  if (/^\d+\.\d+\.\d+$/.test(type)) return type;
  console.error(`Invalid bump type or version: ${type}`);
  process.exit(1);
}

const pkg = JSON.parse(await readFile(files[0], "utf-8"));
const oldVersion = pkg.version;
const newVersion = bump(oldVersion, arg);

for (const file of files) {
  const json = JSON.parse(await readFile(file, "utf-8"));
  json.version = newVersion;
  await writeFile(file, JSON.stringify(json, null, 2) + "\n");
}

const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });

run(`git add package.json .claude-plugin/plugin.json`);
run(`git commit -m "v${newVersion}"`);

if (!noTag) {
  run(`git tag v${newVersion}`);
  console.log(`${oldVersion} → ${newVersion} (tagged v${newVersion})`);
} else {
  console.log(`${oldVersion} → ${newVersion}`);
}
