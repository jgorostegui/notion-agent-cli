import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Load .env from plugin root (replaces dotenv dependency)
try {
  const _pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(new URL(import.meta.url).pathname), "../..");
  const env = await readFile(join(_pluginRoot, ".env"), "utf-8").catch(() => "");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
} catch {}
