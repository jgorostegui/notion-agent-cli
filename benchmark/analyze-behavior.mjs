#!/usr/bin/env node
/**
 * Behavior analysis parser for benchmark JSONL sessions.
 *
 * Extracts per session: skill trigger, first useful turn, discovery overhead,
 * action sequence, help/source usage, intended workflow adherence.
 *
 * Usage:
 *   node benchmark/analyze-behavior.mjs --label nac-s3-1 session.jsonl [...]
 *   node benchmark/analyze-behavior.mjs --label nac-s3-1 session.jsonl --output behavior.json
 */

import { readFileSync, writeFileSync } from "node:fs";

// ── Intended workflows per scenario (ground truth) ──────────────────────────

const INTENDED_WORKFLOWS = {
  1: ["getPage", "createPage"],
  2: ["queryDatabase", "createPage"],
  3: ["copyPageWith"],
  4: ["setProperties"],
  5: ["replaceSection"],
  6: ["createPage", "mergePages"],
  7: ["batchSetProperties"],
  8: ["copyPageWith"],
};

// Actions that count as "useful" (actually doing work, not discovery)
const USEFUL_ACTIONS = new Set([
  "getPage",
  "createPage",
  "queryDatabase",
  "copyPageWith",
  "setProperties",
  "replaceSection",
  "mergePages",
  "batchSetProperties",
  "deepCopy",
  "appendBlocks",
  "updatePage",
  "extractSection",
  "search",
  "workspaceMap",
  "getDatabase",
  "moveBlocks",
  "splitPage",
  "applyTemplate",
]);

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const sessions = [];
  let currentLabel = null;
  let outputFile = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--label") {
      currentLabel = args[++i];
    } else if (args[i] === "--output") {
      outputFile = args[++i];
    } else if (args[i].startsWith("--")) {
      process.stderr.write(`Unknown option: ${args[i]}\n`);
      process.exit(1);
    } else {
      sessions.push({
        label: currentLabel || `session-${sessions.length + 1}`,
        file: args[i],
      });
      currentLabel = null;
    }
  }

  if (sessions.length === 0) {
    process.stderr.write("Usage: node analyze-behavior.mjs --label <name> <file.jsonl> ...\n");
    process.exit(1);
  }

  return { sessions, outputFile };
}

// ── JSONL analysis ──────────────────────────────────────────────────────────

function extractScenario(label) {
  const m = label.match(/s(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function extractActionsFromBashCommand(cmd) {
  // Match: node <path>/actions.mjs <action> ...
  const m = cmd.match(/actions\.mjs\s+(\w+)/);
  return m ? m[1] : null;
}

function analyzeSession(filePath, label) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content
    .trim()
    .split("\n")
    .filter((l) => l.trim());

  const scenario = extractScenario(label);
  let skillTriggered = false;
  let firstUsefulTurn = null;
  let usedHelp = false;
  let usedSourceInspection = false;
  const actionSequence = [];

  let turnIndex = 0;
  let discoveryTurns = 0;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Check for Skill invocation (skill trigger)
    if (entry?.type === "assistant" && entry?.message?.content) {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_use" && block.name === "Skill" && block.input?.skill === "notion-agent-cli") {
            skillTriggered = true;
          }

          // Check for Bash tool calls
          if (block.type === "tool_use" && block.name === "Bash") {
            const cmd = block.input?.command || "";

            // Check for --help usage
            if (cmd.includes("--help") || cmd.includes("--version")) {
              usedHelp = true;
            }

            // Check for source inspection
            if (
              cmd.match(/cat\s+.*actions\.mjs/) ||
              cmd.match(/head\s+.*actions\.mjs/) ||
              cmd.match(/less\s+.*actions\.mjs/) ||
              cmd.match(/wc\s+.*actions\.mjs/) ||
              cmd.includes("which notion") ||
              cmd.includes("type notion") ||
              cmd.includes("file actions")
            ) {
              usedSourceInspection = true;
            }

            // Extract action name from CLI calls
            const action = extractActionsFromBashCommand(cmd);
            if (action && USEFUL_ACTIONS.has(action)) {
              actionSequence.push(action);
              if (firstUsefulTurn === null) {
                firstUsefulTurn = turnIndex + 1; // 1-indexed
              }
            } else if (action === null && !cmd.includes("--help")) {
              // Non-actions.mjs Bash call before first useful turn = discovery
              if (firstUsefulTurn === null) {
                discoveryTurns++;
              }
            }
          }

          // Check for Read tool on actions.mjs (source inspection)
          if (block.type === "tool_use" && block.name === "Read") {
            const path = block.input?.file_path || "";
            if (path.includes("actions.mjs")) {
              usedSourceInspection = true;
            }
          }
        }
        // Count assistant messages as turns
        if (content.some((b) => b.type === "tool_use" || b.type === "text")) {
          turnIndex++;
        }
      }
    }
  }

  // Compute discovery turns (turns before first useful action)
  if (firstUsefulTurn !== null) {
    discoveryTurns = firstUsefulTurn - 1;
  } else {
    discoveryTurns = turnIndex;
  }

  // Check intended workflow match
  const intended = scenario ? INTENDED_WORKFLOWS[scenario] : null;
  let intendedWorkflowMatch = false;
  if (intended && actionSequence.length > 0) {
    // Deduplicate consecutive identical actions for matching
    const deduped = actionSequence.filter((a, i) => i === 0 || a !== actionSequence[i - 1]);
    // Check if the actual sequence contains all intended actions in order
    let idx = 0;
    for (const action of deduped) {
      if (idx < intended.length && action === intended[idx]) {
        idx++;
      }
    }
    intendedWorkflowMatch = idx === intended.length;
  }

  return {
    label,
    scenario,
    skill_triggered: skillTriggered,
    first_useful_turn: firstUsefulTurn,
    discovery_turns: discoveryTurns,
    action_sequence: actionSequence,
    used_help: usedHelp,
    used_source_inspection: usedSourceInspection,
    intended_workflow_match: intendedWorkflowMatch,
    intended_workflow: intended ? intended.join(" -> ") : null,
    actual_workflow: actionSequence.length > 0 ? actionSequence.join(" -> ") : null,
  };
}

// ── Aggregation ─────────────────────────────────────────────────────────────

function computeAggregates(results) {
  const nacResults = results.filter((r) => r.label.startsWith("nac-"));
  if (nacResults.length === 0) return null;

  const triggered = nacResults.filter((r) => r.skill_triggered).length;
  const triggerRate = triggered / nacResults.length;

  const usefulTurns = nacResults
    .filter((r) => r.first_useful_turn !== null)
    .map((r) => r.first_useful_turn)
    .sort((a, b) => a - b);

  const median = usefulTurns.length > 0 ? usefulTurns[Math.floor(usefulTurns.length / 2)] : null;
  const p90 = usefulTurns.length > 0 ? usefulTurns[Math.floor(usefulTurns.length * 0.9)] : null;

  const workflowChecked = nacResults.filter((r) => r.intended_workflow !== null);
  const workflowMatch = workflowChecked.filter((r) => r.intended_workflow_match).length;
  const workflowAdherence = workflowChecked.length > 0 ? workflowMatch / workflowChecked.length : null;

  const helpRate = nacResults.filter((r) => r.used_help).length / nacResults.length;
  const sourceRate = nacResults.filter((r) => r.used_source_inspection).length / nacResults.length;

  return {
    total_sessions: nacResults.length,
    trigger_rate: Math.round(triggerRate * 100) / 100,
    triggered,
    not_triggered: nacResults.length - triggered,
    first_useful_turn_median: median,
    first_useful_turn_p90: p90,
    workflow_adherence: workflowAdherence !== null ? Math.round(workflowAdherence * 100) / 100 : null,
    workflow_matched: workflowMatch,
    workflow_checked: workflowChecked.length,
    help_rate: Math.round(helpRate * 100) / 100,
    source_inspection_rate: Math.round(sourceRate * 100) / 100,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const { sessions, outputFile } = parseArgs(process.argv);
  const results = [];

  for (const session of sessions) {
    process.stderr.write(`Analyzing ${session.file} (${session.label})...\n`);
    const result = analyzeSession(session.file, session.label);
    results.push(result);
  }

  const aggregates = computeAggregates(results);

  // Print summary
  console.log("\n═══ Behavior Analysis ═══\n");
  for (const r of results) {
    const trigger = r.skill_triggered ? "✓ triggered" : "✗ not triggered";
    const workflow = r.intended_workflow_match ? "✓ match" : "✗ mismatch";
    const turn = r.first_useful_turn !== null ? `turn ${r.first_useful_turn}` : "no useful action";
    console.log(`  ${r.label.padEnd(15)} ${trigger.padEnd(18)} ${turn.padEnd(16)} ${workflow}`);
    if (r.action_sequence.length > 0) {
      console.log(`${"".padEnd(17)} actions: ${r.action_sequence.join(" -> ")}`);
    }
  }

  if (aggregates) {
    console.log("\n── Aggregates ──");
    console.log(
      `  Trigger rate:           ${(aggregates.trigger_rate * 100).toFixed(0)}% (${aggregates.triggered}/${aggregates.total_sessions})`,
    );
    console.log(
      `  First useful turn:      median=${aggregates.first_useful_turn_median}, p90=${aggregates.first_useful_turn_p90}`,
    );
    if (aggregates.workflow_adherence !== null) {
      console.log(
        `  Workflow adherence:     ${(aggregates.workflow_adherence * 100).toFixed(0)}% (${aggregates.workflow_matched}/${aggregates.workflow_checked})`,
      );
    }
    console.log(`  Help usage rate:        ${(aggregates.help_rate * 100).toFixed(0)}%`);
    console.log(`  Source inspection rate:  ${(aggregates.source_inspection_rate * 100).toFixed(0)}%`);
  }

  const output = { sessions: results, aggregates };

  if (outputFile) {
    writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`\nResults saved to ${outputFile}`);
  } else {
    console.log(`\n${JSON.stringify(output, null, 2)}`);
  }
}

main();
