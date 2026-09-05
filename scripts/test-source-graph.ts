import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dependencyPath, parseSource, runtimeCycles } from "./source-graph.js";

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
