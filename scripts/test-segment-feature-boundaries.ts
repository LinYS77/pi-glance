import { strict as assert } from "node:assert";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const FEATURE_FILE_PATTERN = /-segment-feature\.ts$/;
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
	"undici",
	"ws",
]);

interface FeatureSource {
	path: string;
	text: string;
	ast: ts.SourceFile;
}

async function readFeatureSources(): Promise<FeatureSource[]> {
	const entries = await readdir(ROOT, { withFileTypes: true });
	return Promise.all(
		entries
			.filter((entry) => entry.isFile() && FEATURE_FILE_PATTERN.test(entry.name))
			.map(async (entry) => {
				const text = await readFile(join(ROOT, entry.name), "utf8");
				return { path: entry.name, text, ast: ts.createSourceFile(entry.name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) };
			}),
	);
}

const features = await readFeatureSources();
assert.ok(features.length > 0, "at least one segment feature should exist");

for (const feature of features) {
	for (const statement of feature.ast.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
		const specifier = statement.moduleSpecifier.text;
		assert.equal(specifier.startsWith("@earendil-works/pi-"), false, `${feature.path}: segment features should consume Glance facts, not Pi directly`);
		assert.equal(IO_NETWORK_PROCESS_IMPORTS.has(specifier), false, `${feature.path}: segment features should not import IO/network/process module ${specifier}`);
	}
	assert.equal(/\b(?:setInterval|setTimeout|setImmediate|requestAnimationFrame)\s*\(/.test(feature.text), false, `${feature.path}: segment features should not own timers`);
	assert.equal(/\.notify\s*\(/.test(feature.text), false, `${feature.path}: segment features should not notify`);
}

console.log(`✓ ${features.length} segment feature dependency guardrails passed`);
