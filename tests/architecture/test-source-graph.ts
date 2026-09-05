import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dependencyPath, parseSource, readProductionSources, runtimeCycles } from "../support/source-graph.js";

test("source discovery recurses through production folders but not test fixtures", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-glance-source-graph-"));
	try {
		await mkdir(join(root, "src", "config"), { recursive: true });
		await mkdir(join(root, "tests", "fixtures"), { recursive: true });
		await writeFile(join(root, "index.ts"), 'import "./src/config/model.js";');
		await writeFile(join(root, "src", "config", "model.ts"), 'export const enabled = true;');
		await writeFile(join(root, "tests", "fixtures", "invalid.ts"), 'import "node:fs";');
		const files = await readProductionSources(root);
		assert.deepEqual(files.map((file) => file.path), ["index.ts", join("src", "config", "model.ts")]);
		assert.equal(dependencyPath(files, "index.ts", (specifier) => specifier === "node:fs"), undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("unresolved local imports fail rather than silently bypass architecture checks", () => {
	const files = [parseSource("entry.ts", 'import "./missing.js";')];
	assert.throws(() => dependencyPath(files, "entry.ts", () => false), /Unresolved local source/);
	assert.throws(() => runtimeCycles(files), /Unresolved local source/);
});

test("dependency rules follow imports, re-exports and literal dynamic imports", () => {
	const files = [
		parseSource("src/view.ts", 'import { model } from "./model.js";'),
		parseSource("src/model.ts", 'export { store } from "./store.js";'),
		parseSource("src/store.ts", 'const fs = import("node:fs/promises");'),
	];
	assert.deepEqual(dependencyPath(files, "src/view.ts", (specifier) => specifier.startsWith("node:fs")),
		["src/view.ts", "src/model.ts", "src/store.ts", "node:fs/promises"]);
});

test("type-only imports and exports do not create runtime dependencies", () => {
	const files = [
		parseSource("view.ts", 'import type { A } from "./io.js"; import { type B } from "./io.js"; export type { C } from "./io.js"; export { type D } from "./io.js";'),
		parseSource("io.ts", 'import "node:fs";'),
	];
	assert.equal(dependencyPath(files, "view.ts", (specifier) => specifier === "node:fs"), undefined);
});

test("cycle detection reports a closed path and accepts a shared DAG", () => {
	assert.deepEqual(runtimeCycles([
		parseSource("a.ts", 'import "./b.js";'),
		parseSource("b.ts", 'import "./a.js";'),
	]), [["a.ts", "b.ts", "a.ts"]]);
	assert.deepEqual(runtimeCycles([
		parseSource("a.ts", 'import "./c.js";'),
		parseSource("b.ts", 'import "./c.js";'),
		parseSource("c.ts", ''),
	]), []);
});
