import { strict as assert } from "node:assert";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

const ROOT = process.cwd();
const THROUGHPUT_MODULE = "throughput.ts";
const THROUGHPUT_RUN_TRACKER_MODULE = "throughput-run-tracker.ts";
const IO_NETWORK_PROCESS_IMPORTS = new Set([
	"fs",
	"fs/promises",
	"node:fs",
	"node:fs/promises",
	"child_process",
	"node:child_process",
	"process",
	"node:process",
	"http",
	"node:http",
	"https",
	"node:https",
	"net",
	"node:net",
	"tls",
	"node:tls",
	"dgram",
	"node:dgram",
	"dns",
	"node:dns",
	"undici",
	"ws",
]);

interface SourceFile {
	path: string;
	text: string;
}

async function readRootTsFiles(): Promise<SourceFile[]> {
	const rootEntries = await readdir(ROOT, { withFileTypes: true });
	return Promise.all(
		rootEntries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
			.map(async (entry) => ({ path: entry.name, text: await readFile(join(ROOT, entry.name), "utf8") })),
	);
}

function fail(message: string): never {
	assert.fail(message);
}

const files = await readRootTsFiles();
const byPath = new Map(files.map((file) => [file.path, file]));
const throughput = files.find((file) => basename(file.path) === THROUGHPUT_MODULE);
assert.ok(throughput, "throughput.ts pure calculation boundary should exist");
const throughputRunTracker = files.find((file) => basename(file.path) === THROUGHPUT_RUN_TRACKER_MODULE);
assert.ok(throughputRunTracker, "throughput-run-tracker.ts pure lifecycle boundary should exist");

const importPattern = /(?:import|export)\s+(type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
const forbiddenThroughputLocalModules = new Set(["./runtime.js", "./renderer.js", "./status-line.js", "./pane.js", "./editor.js", "./config.js", "./settings-catalog.js", "./state.js"]);

function assertPureThroughputImport(file: SourceFile, specifier: string): void {
	if (specifier.startsWith("@earendil-works/pi-")) fail(`${file.path}: throughput pure module must not import pi package ${specifier}`);
	if (IO_NETWORK_PROCESS_IMPORTS.has(specifier)) fail(`${file.path}: throughput pure module must not import IO/network/process module ${specifier}`);
	if (forbiddenThroughputLocalModules.has(specifier)) fail(`${file.path}: throughput pure module must not import UI/runtime/config/state module ${specifier}`);
}

for (const match of throughput.text.matchAll(importPattern)) {
	const isTypeOnly = match[1] === "type ";
	const specifier = match[2]!;
	assertPureThroughputImport(throughput, specifier);
	if (specifier === "./types.js" && !isTypeOnly) fail(`${throughput.path}: throughput may only type-import from ./types.js`);
	if (specifier !== "./types.js") fail(`${throughput.path}: throughput pure module should stay dependency-light; unexpected import ${specifier}`);
}

for (const match of throughputRunTracker.text.matchAll(importPattern)) {
	const isTypeOnly = match[1] === "type ";
	const specifier = match[2]!;
	assertPureThroughputImport(throughputRunTracker, specifier);
	if (specifier === "./types.js" && !isTypeOnly) fail(`${throughputRunTracker.path}: throughput run tracker may only type-import from ./types.js`);
	if (!["./throughput.js", "./types.js"].includes(specifier)) fail(`${throughputRunTracker.path}: throughput run tracker may only import throughput calculation and types, not ${specifier}`);
}

for (const file of [throughput, throughputRunTracker]) {
	if (/\bDate\.now\s*\(/.test(file.text)) fail(`${file.path}: throughput pure module must use injected timestamps, not Date.now()`);
	if (/\.notify\s*\(/.test(file.text)) fail(`${file.path}: throughput pure module must never notify`);
	if (/(?:\.\s*(?:content|delta|text_delta|thinking_delta)\b|\[\s*["'](?:content|delta|text_delta|thinking_delta)["']\s*\])/.test(file.text)) {
		fail(`${file.path}: throughput pure module must not read message content/delta text as a token fallback`);
	}
	if (/\.\s*length\b/.test(file.text)) {
		fail(`${file.path}: throughput pure module must not use string/content length as a token fallback`);
	}
}

for (const file of files) {
	if (/\.notify\s*\([^;\n]*(?:throughput|reply speed|TPS|tok\/s|spd)/i.test(file.text)) {
		fail(`${file.path}: throughput/Reply speed copy should not be sent through ctx.ui.notify`);
	}
}

for (const fileName of ["throughput.ts", "throughput-run-tracker.ts", "runtime.ts", "segment-registry.ts", "renderer.ts", "status-line.ts"] as const) {
	const file = byPath.get(fileName);
	assert.ok(file, `${fileName} should exist for throughput boundary checks`);
	if (/\b(?:setInterval|setTimeout|setImmediate|requestAnimationFrame)\s*\(/.test(file.text)) {
		fail(`${file.path}: Reply speed UX v2 must not use timers/tickers for provisional or unknown status`);
	}
}

for (const fileName of ["throughput.ts", "throughput-run-tracker.ts", "runtime.ts", "segment-registry.ts"] as const) {
	const file = byPath.get(fileName);
	assert.ok(file, `${fileName} should exist for throughput estimation boundary checks`);
	if (/(?:\.\s*(?:content|delta|text_delta|thinking_delta)\b|\[\s*["'](?:content|delta|text_delta|thinking_delta)["']\s*\])/.test(file.text)) {
		fail(`${file.path}: Reply speed must not inspect content/delta text for token estimation`);
	}
}

console.log("✓ throughput boundary checks passed");
