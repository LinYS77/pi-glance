import { strict as assert } from "node:assert";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const MODEL_SPEED_FILES = [
	"throughput.ts",
	"throughput-run-tracker.ts",
	"throughput-segment-feature.ts",
	"runtime-refresh-session.ts",
	"runtime.ts",
] as const;
const PURE_MODEL_SPEED_FILES = new Set(["throughput.ts", "throughput-run-tracker.ts"]);
const NO_NOTIFY_MODEL_SPEED_FILES = new Set(["throughput.ts", "throughput-run-tracker.ts", "throughput-segment-feature.ts"]);
const IO_NETWORK_PROCESS_IMPORTS = new Set([
	"fs",
	"fs/promises",
	"node:fs",
	"node:fs/promises",
	"child_process",
	"node:child_process",
	"http",
	"node:http",
	"https",
	"node:https",
	"net",
	"node:net",
	"tls",
	"node:tls",
	"undici",
	"ws",
]);

interface SourceFile {
	path: string;
	text: string;
	ast: ts.SourceFile;
}

async function readRootSources(): Promise<SourceFile[]> {
	const entries = await readdir(ROOT, { withFileTypes: true });
	return Promise.all(
		entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
			.map(async (entry) => {
				const text = await readFile(join(ROOT, entry.name), "utf8");
				return { path: entry.name, text, ast: ts.createSourceFile(entry.name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) };
			}),
	);
}

const files = await readRootSources();
const byPath = new Map(files.map((file) => [file.path, file]));
const modelSpeedFiles = MODEL_SPEED_FILES.map((path) => {
	const file = byPath.get(path);
	assert.ok(file, `${path} should exist`);
	return file;
});

for (const file of modelSpeedFiles) {
	assert.equal(/\b(?:setInterval|setTimeout|setImmediate|requestAnimationFrame)\s*\(/.test(file.text), false, `${file.path}: Model speed must not use timers or tickers`);
	if (NO_NOTIFY_MODEL_SPEED_FILES.has(file.path)) {
		assert.equal(/\.notify\s*\(/.test(file.text), false, `${file.path}: Model speed modules must not notify`);
	}
	assert.equal(
		/(?:\.\s*(?:content|delta|text_delta|thinking_delta)\b|\[\s*["'](?:content|delta|text_delta|thinking_delta)["']\s*\])/.test(file.text),
		false,
		`${file.path}: Model speed must not estimate tokens from message or delta content`,
	);

	if (!PURE_MODEL_SPEED_FILES.has(file.path)) continue;
	assert.equal(/\bDate\.now\s*\(/.test(file.text), false, `${file.path}: pure Model speed logic should use injected timestamps`);
	for (const statement of file.ast.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
		const specifier = statement.moduleSpecifier.text;
		assert.equal(specifier.startsWith("@earendil-works/pi-"), false, `${file.path}: pure Model speed logic must not import Pi`);
		assert.equal(IO_NETWORK_PROCESS_IMPORTS.has(specifier), false, `${file.path}: pure Model speed logic must not import ${specifier}`);
	}
}

for (const file of files) {
	assert.equal(/\.notify\s*\([^;\n]*(?:throughput|model speed|TPS|tok\/s|spd)/i.test(file.text), false, `${file.path}: Model speed copy must not be sent through notifications`);
}

console.log("✓ Model speed safety guardrails passed");
