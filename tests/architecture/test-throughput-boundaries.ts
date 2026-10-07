import { strict as assert } from "node:assert";
import { importsFrom, IO_NETWORK_PROCESS_IMPORTS, readProductionSources } from "../support/source-graph.js";

const MODEL_SPEED_FILES = [
	"src/runtime/throughput.ts",
	"src/runtime/throughput-run-tracker.ts",
	"src/segments/throughput.ts",
	"src/runtime/refresh-session.ts",
	"src/runtime/runtime.ts",
] as const;
const PURE_MODEL_SPEED_FILES = new Set(["src/runtime/throughput.ts", "src/runtime/throughput-run-tracker.ts"]);
const NO_NOTIFY_MODEL_SPEED_FILES = new Set(["src/runtime/throughput.ts", "src/runtime/throughput-run-tracker.ts", "src/segments/throughput.ts"]);
const files = await readProductionSources();
const byPath = new Map(files.map((file) => [file.path, file]));
const modelSpeedFiles = MODEL_SPEED_FILES.map((path) => {
	const file = byPath.get(path);
	assert.ok(file, `${path} should exist`);
	return file;
});

for (const file of modelSpeedFiles) {
	assert.equal(/\b(?:setInterval|setTimeout|setImmediate|requestAnimationFrame)\s*\(/.test(file.text), false, `${file.path}: Output throughput must not use timers or tickers`);
	if (NO_NOTIFY_MODEL_SPEED_FILES.has(file.path)) {
		assert.equal(/\.notify\s*\(/.test(file.text), false, `${file.path}: Output throughput modules must not notify`);
	}
	assert.equal(
		/(?:\.\s*(?:content|delta|text_delta|thinking_delta)\b|\[\s*["'](?:content|delta|text_delta|thinking_delta)["']\s*\])/.test(file.text),
		false,
		`${file.path}: Output throughput must not estimate tokens from message or delta content`,
	);

	if (!PURE_MODEL_SPEED_FILES.has(file.path)) continue;
	assert.equal(/\bDate\.now\s*\(/.test(file.text), false, `${file.path}: pure Output throughput logic should use injected timestamps`);
	for (const { specifier } of importsFrom(file)) {
		assert.equal(specifier.startsWith("@earendil-works/pi-"), false, `${file.path}: pure Output throughput logic must not import Pi`);
		assert.equal(IO_NETWORK_PROCESS_IMPORTS.has(specifier), false, `${file.path}: pure Output throughput logic must not import ${specifier}`);
	}
}

for (const file of files) {
	assert.equal(/\.notify\s*\([^;\n]*(?:throughput|model speed|TPS|tok\/s|spd)/i.test(file.text), false, `${file.path}: Output throughput copy must not be sent through notifications`);
}

const entry = byPath.get("index.ts");
const runtime = byPath.get("src/runtime/runtime.ts");
assert.ok(entry && runtime);
assert.match(entry.text, /pi\.on\("before_provider_request", runtime\.events\.providerRequest\)/, "wire the pre-request boundary through the public Pi event");
assert.match(runtime.text, /performance\.now\(\)/, "use a monotonic production clock");

console.log("✓ Output throughput safety guardrails passed");
