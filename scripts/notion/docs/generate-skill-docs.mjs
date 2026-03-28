#!/usr/bin/env node
/**
 * Generates skill references and SKILL.md sections from ACTION_CATALOG.
 *
 * Usage:
 *   node scripts/notion/docs/generate-skill-docs.mjs          # write all files
 *   node scripts/notion/docs/generate-skill-docs.mjs --check   # exit non-zero if stale
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ACTION_CATALOG } from "../cli/registry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const SKILL_PATH = resolve(ROOT, "skills/notion-agent-cli/SKILL.md");
const ACTION_REF_PATH = resolve(ROOT, "skills/notion-agent-cli/references/action-reference.md");
const WORKFLOWS_PATH = resolve(ROOT, "skills/notion-agent-cli/references/workflows.md");

const CATEGORY_ORDER = [
	["read", "READ Actions"],
	["write", "WRITE Actions"],
	["structural", "STRUCTURAL Actions"],
	["batch", "BATCH Actions"],
	["safety", "SAFETY Actions"],
	["analysis", "ANALYSIS Actions"],
];

// ── action-reference.md ───────────────────────────────────────────────

const ACTION_REF_TAIL = `## Stdin Mode

Pipe JSON directly to avoid temp files:

\`\`\`bash
echo '{"action": "createPage", "parentId": "abc", "title": "Title", "content": "markdown"}' | node \${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs -
\`\`\`

## JSON Request File Format

For large content payloads, write a JSON file and pass it as the argument:

\`\`\`bash
node \${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs /tmp/req.json
\`\`\`

\`\`\`json
{"action": "createPage", "parentId": "abc", "title": "My Page", "contentFile": "/tmp/content.md"}
{"action": "updatePage", "pageId": "abc", "contentFile": "/tmp/content.md"}
{"action": "replaceSection", "pageId": "abc", "headingText": "Intro", "content": "New intro text"}
{"action": "queryDatabase", "dbId": "abc", "filter": {"property": "Status", "select": {"equals": "Done"}}}
{"action": "setProperties", "pageId": "id", "props": {"Status": "Done", "Priority": "High"}}
\`\`\`

## API Limits

- **Rate limit**: ~3 req/s (auto-enforced at 2.5 req/s)
- **100 blocks** max per append request (auto-chunked)
- **2000 chars** max per rich_text (auto-chunked)
- **2 levels** nesting per create request
- **5000 blocks** max per recursive fetch (silently truncates)
- Search is eventually consistent
- File URLs expire after ~1 hour`;

function formatArgSig(meta) {
	const parts = [
		...meta.args.map((a) => (a.required !== false ? a.name : `${a.name}?`)),
		...meta.options.map((o) => `{${o.name}?}`),
	];
	return parts.join(", ");
}

function generateActionReference() {
	const lines = [
		"<!-- Generated from ACTION_CATALOG — do not edit manually -->",
		`<!-- Run: node scripts/notion/docs/generate-skill-docs.mjs -->`,
		"",
		"# Notion Agent CLI — Full Reference",
		"",
		"All actions are invoked via CLI:",
		"",
		"```bash",
		"node ${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs <action> [args...]",
		"```",
		"",
	];

	for (const [cat, label] of CATEGORY_ORDER) {
		const entries = Object.entries(ACTION_CATALOG).filter(([, m]) => m.category === cat);
		if (entries.length === 0) continue;
		lines.push(`## ${label}`, "");
		lines.push("| Action | Args | Description |");
		lines.push("|---|---|---|");
		for (const [name, meta] of entries) {
			lines.push(`| \`${name}\` | \`${formatArgSig(meta)}\` | ${meta.summary} |`);
		}
		lines.push("");
	}

	lines.push(ACTION_REF_TAIL, "");
	return lines.join("\n");
}

// ── workflows.md ──────────────────────────────────────────────────────

const WORKFLOWS_HEADER = `<!-- Generated from ACTION_CATALOG — do not edit manually -->
<!-- Run: node scripts/notion/docs/generate-skill-docs.mjs -->

# Notion Agent CLI — Compound Workflow Recipes

Prefer compound actions over multi-step workflows. Each recipe below shows the single-call approach.`;

const STDIN_RECIPE = `## Large Content via Stdin

Pipe JSON directly to avoid creating temp files:

\`\`\`bash
cat <<'EOF' | node \${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs -
{"action": "createPage", "parentId": "abc", "title": "My Page", "content": "## Full markdown content\\n\\nWith **formatting**, lists, code blocks, etc."}
EOF
\`\`\`

For content stored in a file:

\`\`\`bash
jq -n --arg content "$(cat /tmp/content.md)" '{"action":"createPage","parentId":"abc","title":"Title","content":$content}' | node \${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs -
\`\`\``;

function generateWorkflows() {
	const lines = [WORKFLOWS_HEADER, ""];

	for (const [name, meta] of Object.entries(ACTION_CATALOG)) {
		if (!meta.docs.workflow) continue;
		lines.push(`## ${meta.docs.workflowTitle}`, "");
		lines.push(`Use \`${name}\` to ${meta.summary.toLowerCase().replace(/\.$/, "")}.`, "");

		if (meta.examples.length > 0) {
			lines.push("```bash");
			for (const ex of meta.examples) {
				lines.push(`node \${CLAUDE_PLUGIN_ROOT}/scripts/actions.mjs ${ex.replace(/^node actions\.mjs /, "")}`);
			}
			lines.push("```", "");
		}

		if (meta.replacesWorkflows.length > 0) {
			lines.push(`Equivalent to: ${meta.replacesWorkflows.join("; ")} — but in 1 CLI call.`, "");
		}

		if (meta.docs.workflowNotes) {
			lines.push(meta.docs.workflowNotes, "");
		}

		if (meta.skill.gotchas.length > 0) {
			for (const g of meta.skill.gotchas) lines.push(`> **Note**: ${g}`, "");
		}
	}

	lines.push(STDIN_RECIPE, "");
	return lines.join("\n");
}

// ── SKILL.md marker blocks ────────────────────────────────────────────

function generateSkillSection(sectionName) {
	if (sectionName === "quick-patterns") {
		const lines = ["### Quick Patterns", ""];
		for (const [, meta] of Object.entries(ACTION_CATALOG)) {
			if (meta.skill.quickPattern) lines.push(`- ${meta.skill.quickPattern}`);
		}
		return lines.join("\n");
	}

	if (sectionName === "decision-tree") {
		const lines = ["## Decision Tree", ""];
		// Group by routeLabel, collect alternatives with same label
		const groups = new Map();
		for (const [name, meta] of Object.entries(ACTION_CATALOG)) {
			if (!meta.skill.includeInDecisionTree || !meta.skill.routeLabel) continue;
			const label = meta.skill.routeLabel;
			if (!groups.has(label)) groups.set(label, []);
			groups.get(label).push({ name, meta });
		}
		for (const [label, entries] of groups) {
			const cmds = entries
				.filter((e) => e.meta.skill.routeCommand)
				.map((e) => `\`${e.meta.skill.routeCommand}\``);
			// Also include actions without routeCommand as named alternatives
			const namedAlts = entries
				.filter((e) => !e.meta.skill.routeCommand)
				.map((e) => `\`${e.name}\``);
			const allCmds = [...cmds, ...namedAlts];
			const cmd = allCmds.join(" or ");
			let line = `- **${label}** -> ${cmd}`;
			// Inline hints: only for specific actions where the hint adds clarity
			for (const e of entries) {
				if (e.name === "queryDatabase") line += ` (markdown table; \`--format raw\` for JSON)`;
				if (e.name === "importTable") line += " (infers column types)";
			}
			lines.push(line);
		}
		return lines.join("\n");
	}

	if (sectionName === "gotchas") {
		const lines = ["## Common Pitfalls", ""];
		const items = [];
		// Collect gotchas from preferInstead fields (anti-patterns)
		for (const [name, meta] of Object.entries(ACTION_CATALOG)) {
			for (const pi of meta.preferInstead) {
				items.push(`Do NOT use \`${name}\` when \`${pi.action}\` ${pi.reason}`);
			}
		}
		// Collect gotchas from skill.gotchas that are important enough
		const importantGotchas = [];
		for (const [, meta] of Object.entries(ACTION_CATALOG)) {
			for (const g of meta.skill.gotchas) {
				if (!importantGotchas.includes(g)) importantGotchas.push(g);
			}
		}
		// Curated order: the most impactful anti-patterns first
		const curated = [
			"Do NOT fetch database entries individually — `queryDatabase` returns all in one call",
			"Do NOT use `getPage` + `createPage` when `copyPageWith` does both in one call",
			"Do NOT use multiple `setProperties` when `batchSetProperties` handles N pages",
			"Do NOT read the script source — use `schema <action>` or the references below",
			"`mergePages` target must already exist — use `createPage` first to create it",
			"Large content (>4KB) should use stdin mode, not inline CLI args",
			"Properties are auto-typed from the database schema — pass simple values like `{\"Status\": \"Done\"}`, not raw Notion API format",
			"File/image URLs expire after ~1 hour — re-fetch if reusing later",
		];
		for (let i = 0; i < curated.length; i++) {
			lines.push(`${i + 1}. ${curated[i]}`);
		}
		return lines.join("\n");
	}

	if (sectionName === "references") {
		return [
			"## References",
			"",
			"- **`references/action-reference.md`** — Read when you need exact parameter names or options for an unfamiliar action.",
			"- **`references/workflows.md`** — Read when combining operations or piping large content via stdin.",
			"- **`references/api-limits.md`** — Read when hitting API errors, size limits, or unexpected behavior.",
		].join("\n");
	}

	throw new Error(`Unknown section: ${sectionName}`);
}

const REQUIRED_SECTIONS = ["quick-patterns", "decision-tree", "gotchas", "references"];

async function updateSkillMd(check) {
	let content = await readFile(SKILL_PATH, "utf-8");

	// Validate all marker blocks exist before modifying
	for (const section of REQUIRED_SECTIONS) {
		const begin = `<!-- BEGIN GENERATED: ${section} -->`;
		const end = `<!-- END GENERATED: ${section} -->`;
		if (!content.includes(begin) || !content.includes(end)) {
			throw new Error(`Missing marker block for "${section}" in SKILL.md. Expected ${begin} ... ${end}`);
		}
	}

	for (const section of REQUIRED_SECTIONS) {
		const begin = `<!-- BEGIN GENERATED: ${section} -->`;
		const end = `<!-- END GENERATED: ${section} -->`;
		const beginIdx = content.indexOf(begin);
		const endIdx = content.indexOf(end);
		const generated = generateSkillSection(section);
		content = content.slice(0, beginIdx + begin.length) + "\n" + generated + "\n" + content.slice(endIdx);
	}

	return content;
}

// ── Main ──────────────────────────────────────────────────────────────

const isCheck = process.argv.includes("--check");

try {
	const [newActionRef, newWorkflows, newSkill] = await Promise.all([
		generateActionReference(),
		generateWorkflows(),
		updateSkillMd(isCheck),
	]);

	if (isCheck) {
		const [curActionRef, curWorkflows, curSkill] = await Promise.all([
			readFile(ACTION_REF_PATH, "utf-8"),
			readFile(WORKFLOWS_PATH, "utf-8"),
			readFile(SKILL_PATH, "utf-8"),
		]);

		let stale = false;
		if (curActionRef !== newActionRef) {
			console.error("action-reference.md is stale");
			stale = true;
		}
		if (curWorkflows !== newWorkflows) {
			console.error("workflows.md is stale");
			stale = true;
		}
		if (curSkill !== newSkill) {
			console.error("SKILL.md generated sections are stale");
			stale = true;
		}
		if (stale) {
			console.error("Run: node scripts/notion/docs/generate-skill-docs.mjs");
			process.exit(1);
		}
		console.log("All generated docs are up to date.");
	} else {
		// All-or-nothing: write all files only after all content is generated
		await Promise.all([
			writeFile(ACTION_REF_PATH, newActionRef),
			writeFile(WORKFLOWS_PATH, newWorkflows),
			writeFile(SKILL_PATH, newSkill),
		]);
		console.log("Generated:");
		console.log(`  ${ACTION_REF_PATH}`);
		console.log(`  ${WORKFLOWS_PATH}`);
		console.log(`  ${SKILL_PATH} (marker blocks updated)`);
	}
} catch (e) {
	console.error(e.message);
	process.exit(1);
}
