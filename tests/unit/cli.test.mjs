import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { describe, it } from "node:test";
import { ACTIONS, toCamelCase } from "../../scripts/actions.mjs";

describe("toCamelCase", () => {
	it("converts snake_case to camelCase", () => {
		assert.equal(toCamelCase("get_page"), "getPage");
		assert.equal(toCamelCase("workspace_map"), "workspaceMap");
		assert.equal(toCamelCase("find_duplicates"), "findDuplicates");
	});

	it("leaves camelCase unchanged", () => {
		assert.equal(toCamelCase("getPage"), "getPage");
		assert.equal(toCamelCase("search"), "search");
	});
});

/** Spawn the CLI without NOTION_TOKEN to test meta commands */
function runCli(args) {
	return new Promise((resolve) => {
		const env = { ...process.env };
		delete env.NOTION_TOKEN;
		execFile("node", ["scripts/actions.mjs", ...args], { env }, (err, stdout, stderr) => {
			resolve({ code: err?.code || 0, stdout, stderr });
		});
	});
}

describe("schema CLI command", () => {
	it("schema exits 0 and contains all action names", async () => {
		const { code, stdout } = await runCli(["schema"]);
		assert.equal(code, 0);
		for (const name of Object.keys(ACTIONS)) {
			assert.ok(stdout.includes(name), `schema output missing action: ${name}`);
		}
	});

	it("schema getPage exits 0 with details", async () => {
		const { code, stdout } = await runCli(["schema", "getPage"]);
		assert.equal(code, 0);
		assert.ok(stdout.includes("getPage"));
		assert.ok(stdout.includes("readPage") || stdout.includes("fetchPage"), "should include aliases");
		assert.ok(stdout.includes("node actions.mjs"), "should include examples");
	});

	it("schema --format json exits 0 with valid JSON", async () => {
		const { code, stdout } = await runCli(["schema", "--format", "json"]);
		assert.equal(code, 0);
		const parsed = JSON.parse(stdout);
		assert.ok(typeof parsed === "object");
		assert.ok(parsed.getPage, "JSON should contain getPage");
	});

	it("schema --format json getPage exits 0 (reversed arg order)", async () => {
		const { code, stdout } = await runCli(["schema", "--format", "json", "getPage"]);
		assert.equal(code, 0);
		const parsed = JSON.parse(stdout);
		assert.equal(parsed.name, "getPage");
	});

	it("schema unknownAction exits 1", async () => {
		const { code } = await runCli(["schema", "unknownAction"]);
		assert.equal(code, 1);
	});
});

describe("help CLI command", () => {
	it("help (no arg) exits 0 and prints general help", async () => {
		const { code, stdout } = await runCli(["help"]);
		assert.equal(code, 0);
		assert.ok(stdout.includes("Usage:"), "should include Usage header");
	});

	it("help getPage exits 0 with signature and examples", async () => {
		const { code, stdout } = await runCli(["help", "getPage"]);
		assert.equal(code, 0);
		assert.ok(stdout.includes("getPage"));
		assert.ok(stdout.includes("<pageId>"));
		assert.ok(stdout.includes("Examples:"));
	});

	it("help unknownAction exits 1", async () => {
		const { code } = await runCli(["help", "unknownAction"]);
		assert.equal(code, 1);
	});
});

describe("--help and -h", () => {
	it("--help exits 0", async () => {
		const { code, stdout } = await runCli(["--help"]);
		assert.equal(code, 0);
		assert.ok(stdout.includes("Usage:"));
	});

	it("-h exits 0", async () => {
		const { code, stdout } = await runCli(["-h"]);
		assert.equal(code, 0);
		assert.ok(stdout.includes("Usage:"));
	});

	it("no args exits 1 (but still prints help)", async () => {
		const { code, stdout } = await runCli([]);
		assert.equal(code, 1);
		assert.ok(stdout.includes("Usage:"));
	});
});
