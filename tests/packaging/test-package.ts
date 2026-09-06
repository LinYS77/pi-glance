import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { readProductionSources } from "../support/source-graph.js";

interface PackResult {
	name: string;
	version: string;
	files: Array<{ path: string }>;
}

test("npm package includes the complete source tree and excludes development files", async () => {
	const manifest = JSON.parse(await readFile("package.json", "utf8"));
	const { stdout } = await promisify(execFile)("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { maxBuffer: 1024 * 1024, timeout: 120_000 });
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

test("developer clean removes only generated test output and can run twice", async () => {
	const manifest = JSON.parse(await readFile("package.json", "utf8"));
	assert.equal(typeof manifest.scripts.clean, "string", "provide an explicit build-output cleanup command");
	const root = await mkdtemp(join(tmpdir(), "pi-glance-clean-"));
	try {
		await writeFile(join(root, "package.json"), JSON.stringify({ private: true, scripts: { clean: manifest.scripts.clean } }));
		await mkdir(join(root, ".tmp-test", "nested"), { recursive: true });
		await writeFile(join(root, ".tmp-test", "nested", "compiled.js"), "generated");
		for (const directory of ["src", "node_modules", ".pi"]) {
			await mkdir(join(root, directory));
			await writeFile(join(root, directory, "keep.txt"), "keep");
		}
		await writeFile(join(root, "pi-glance-0.6.7.tgz"), "keep release archive");
		for (let run = 0; run < 2; run++) {
			await promisify(execFile)("npm", ["run", "clean", "--silent"], { cwd: root, timeout: 30_000 });
			assert.equal((await readdir(root)).includes(".tmp-test"), false);
			for (const directory of ["src", "node_modules", ".pi"]) assert.equal(await readFile(join(root, directory, "keep.txt"), "utf8"), "keep");
			assert.equal(await readFile(join(root, "pi-glance-0.6.7.tgz"), "utf8"), "keep release archive");
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
