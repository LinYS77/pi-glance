import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { readProductionSources } from "./source-graph.js";

interface PackResult {
	name: string;
	version: string;
	files: Array<{ path: string }>;
}

test("npm package includes the complete source tree and excludes development files", async () => {
	const manifest = JSON.parse(await readFile("package.json", "utf8"));
	const { stdout } = await promisify(execFile)("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { maxBuffer: 1024 * 1024 });
	const [pack] = JSON.parse(stdout) as PackResult[];
	assert.ok(pack);
	assert.equal(pack.name, "pi-glance");
	assert.equal(pack.version, manifest.version);
	assert.deepEqual(manifest.pi.extensions, ["./index.ts"], "Pi entry point remains stable");
	assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, "no bundled runtime dependencies");
	const packed = new Set(pack.files.map((file) => file.path));
	const sources = await readProductionSources();
	const expected = new Set([...sources.map((file) => file.path), "package.json", "README.md", "README.zh-CN.md", "LICENSE"]);
	assert.deepEqual([...packed].sort(), [...expected].sort(), "ship all runtime TypeScript, but no tests, fixtures, build output or local state");
});
