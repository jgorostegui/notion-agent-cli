#!/usr/bin/env node

/**
 * View 2: Parse Claude Code session JSONL files for token usage.
 *
 * Usage:
 *   node benchmark/parse-sessions.mjs \
 *     --label "notion-agent-cli" session1.jsonl \
 *     --label "MCP" session2.jsonl
 *
 * Reports per session:
 *   - input_tokens (total processed)
 *   - cache_read_input_tokens
 *   - cache_creation_input_tokens
 *   - billed_input_tokens ≈ input_tokens - cache_read_input_tokens
 *   - output_tokens
 *   - turns count
 */

import { readFileSync } from "node:fs";

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const sessions = [];
  let currentLabel = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--label") {
      currentLabel = args[++i];
    } else if (args[i].startsWith("--")) {
      process.stderr.write(`Unknown option: ${args[i]}\n`);
      process.exit(1);
    } else {
      // File path
      sessions.push({
        label: currentLabel || `session-${sessions.length + 1}`,
        file: args[i],
      });
      currentLabel = null;
    }
  }

  if (sessions.length === 0) {
    process.stderr.write("Usage: node benchmark/parse-sessions.mjs --label <name> <file.jsonl> ...\n");
    process.exit(1);
  }

  return sessions;
}

// ── JSONL Parser ─────────────────────────────────────────────────────────────

/**
 * Parse a Claude Code session JSONL file and extract token usage.
 *
 * Claude Code JSONL lines have varying formats. We look for:
 * - message.usage.input_tokens
 * - message.usage.output_tokens
 * - message.usage.cache_read_input_tokens
 * - message.usage.cache_creation_input_tokens
 */
function parseSessionFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content
    .trim()
    .split("\n")
    .filter((l) => l.trim());

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let turns = 0;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // Skip malformed lines
    }

    // Look for usage data in various possible locations
    const usage = entry?.message?.usage || entry?.usage || entry?.response?.usage;

    if (!usage) continue;

    // Anthropic API token fields:
    //   input_tokens        = new (non-cached) input tokens
    //   cache_read_input_tokens   = tokens served from cache (75% discount)
    //   cache_creation_input_tokens = tokens written to cache (25% surcharge)
    //   output_tokens       = generated tokens
    //
    // Total context processed = input_tokens + cache_read + cache_creation
    // Billed input ≈ input_tokens + cache_creation (full price tokens)

    const inputTk = usage.input_tokens || 0;
    const outputTk = usage.output_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheCreation = usage.cache_creation_input_tokens || 0;

    // Only count assistant messages (have output or tool calls) as turns
    if (entry?.type === "assistant" || inputTk > 0 || outputTk > 0 || cacheRead > 0 || cacheCreation > 0) {
      totalInputTokens += inputTk;
      totalOutputTokens += outputTk;
      totalCacheRead += cacheRead;
      totalCacheCreation += cacheCreation;
      turns++;
    }
  }

  // Total context processed per session (what the model actually saw)
  const totalProcessed = totalInputTokens + totalCacheRead + totalCacheCreation;
  // Billed input ≈ new tokens + cache creation (both at full or surcharge rate)
  // Cache reads are 75% cheaper, so exclude from "billed"
  const billedInputTokens = totalInputTokens + totalCacheCreation;

  return {
    totalProcessed,
    totalInputTokens,
    totalOutputTokens,
    totalCacheRead,
    totalCacheCreation,
    billedInputTokens,
    turns,
  };
}

// ── Reporting ────────────────────────────────────────────────────────────────

function padRight(str, len) {
  return String(str).padEnd(len);
}

function padLeft(str, len) {
  return String(str).padStart(len);
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

function printReport(sessions, results) {
  const colWidth = 22;
  const metricWidth = 34;
  const labels = sessions.map((s) => s.label);

  console.log(`\n${"═".repeat(metricWidth + labels.length * colWidth)}`);
  console.log("  View 2: Claude Code Session Token Analysis");
  console.log(`${"═".repeat(metricWidth + labels.length * colWidth)}`);

  // Header
  console.log(padRight("Metric", metricWidth) + labels.map((l) => padLeft(l, colWidth)).join(""));
  console.log("─".repeat(metricWidth + labels.length * colWidth));

  const metrics = [
    ["Total context (in+cache)", "totalProcessed"],
    ["New input tokens", "totalInputTokens"],
    ["Cache read tokens (75% off)", "totalCacheRead"],
    ["Cache creation tokens", "totalCacheCreation"],
    ["Billed input (new+creation)", "billedInputTokens"],
    ["Output tokens", "totalOutputTokens"],
    ["Turns", "turns"],
  ];

  for (const [label, key] of metrics) {
    let row = padRight(label, metricWidth);
    for (const r of results) {
      row += padLeft(fmt(r[key]), colWidth);
    }
    console.log(row);
  }

  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const sessions = parseArgs(process.argv);
  const results = [];

  for (const session of sessions) {
    process.stderr.write(`Parsing ${session.file} (${session.label})...\n`);
    const result = parseSessionFile(session.file);
    results.push(result);
    process.stderr.write(`  ${result.turns} turns, ${fmt(result.totalInputTokens)} input tokens\n`);
  }

  printReport(sessions, results);

  // Also output JSON for programmatic use
  const jsonOutput = sessions.map((s, i) => ({
    label: s.label,
    file: s.file,
    ...results[i],
  }));
  console.log(JSON.stringify(jsonOutput, null, 2));
}

main();
