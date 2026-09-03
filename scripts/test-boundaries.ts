import { strict as assert } from "node:assert";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const LEGACY_NAMESPACE = ["@mariozechner", ""].join("/");
const ALLOWED_PI_IMPORTS = new Set([
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
]);
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
const RENDER_MODULES = new Set([
	"editor.ts",
	"renderer.ts",
	"pane.ts",
	"segments.ts",
	"surface-layout.ts",
	"input-surface-frame.ts",
	"footer.ts",
	"status-line.ts",
	"settings-catalog.ts",
]);

interface SourceFile {
	path: string;
	text: string;
	ast: ts.SourceFile;
}

interface ImportRecord {
	specifier: string;
	typeOnly: boolean;
}

async function readRootSourceFiles(): Promise<SourceFile[]> {
	const entries = await readdir(ROOT, { withFileTypes: true });
	return Promise.all(
		entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
			.map(async (entry) => {
				const text = await readFile(join(ROOT, entry.name), "utf8");
				return {
					path: entry.name,
					text,
					ast: ts.createSourceFile(entry.name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
				};
			}),
	);
}

function fail(message: string): never {
	assert.fail(message);
}

function importsFrom(file: SourceFile): ImportRecord[] {
	const records: ImportRecord[] = [];
	for (const statement of file.ast.statements) {
		if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
			records.push({ specifier: statement.moduleSpecifier.text, typeOnly: statement.importClause?.isTypeOnly === true });
			continue;
		}
		if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
			records.push({ specifier: statement.moduleSpecifier.text, typeOnly: statement.isTypeOnly });
		}
	}
	return records;
}

function assertCompatibilityBaseline(packageText: string, lockText: string): void {
	const manifest = JSON.parse(packageText) as {
		engines?: Record<string, string>;
		devDependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
	};
	const lock = JSON.parse(lockText) as {
		packages?: Record<string, { engines?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> }>;
	};
	const expectedDevDependencies = {
		"@earendil-works/pi-ai": "0.84.4",
		"@earendil-works/pi-coding-agent": "0.84.4",
		"@earendil-works/pi-tui": "0.84.4",
		"@types/node": "24.12.4",
		typescript: "5.9.3",
	};
	assert.deepEqual(manifest.devDependencies, expectedDevDependencies, "package.json should pin the Pi 0.84.4 development baseline");
	assert.deepEqual(lock.packages?.[""]?.devDependencies, expectedDevDependencies, "package-lock should match the development baseline");
	assert.equal(manifest.engines?.node, ">=22.19.0", "package.json should preserve Pi's Node floor");
	assert.equal(lock.packages?.[""]?.engines?.node, ">=22.19.0", "package-lock should preserve Pi's Node floor");
	for (const packageName of ALLOWED_PI_IMPORTS) {
		assert.equal(manifest.peerDependencies?.[packageName], "*", `${packageName} should remain a Pi-supplied wildcard peer`);
		assert.equal(lock.packages?.[""]?.peerDependencies?.[packageName], "*", `package-lock should preserve wildcard peer ${packageName}`);
	}
}

function assertPublicPiImports(files: SourceFile[]): void {
	for (const file of files) {
		for (const record of importsFrom(file)) {
			if (record.specifier.startsWith(LEGACY_NAMESPACE)) fail(`${file.path}: legacy Pi import ${record.specifier}`);
			if (record.specifier.startsWith("@earendil-works/pi-") && !ALLOWED_PI_IMPORTS.has(record.specifier)) {
				fail(`${file.path}: private/deep Pi import ${record.specifier}`);
			}
		}
	}
}

function assertNoCorePatching(files: SourceFile[]): void {
	const patterns: Array<[RegExp, string]> = [
		[/\bObject\.definePropert(?:y|ies)\s*\(/, "Object.defineProperty"],
		[/\bReflect\.defineProperty\s*\(/, "Reflect.defineProperty"],
		[/\bObject\.setPrototypeOf\s*\(/, "Object.setPrototypeOf"],
		[/__proto__/, "__proto__ mutation"],
		[/\.prototype(?:\.[A-Za-z_$][\w$]*)?\s*=/, "prototype mutation"],
		[/\bglobalThis\.[A-Za-z_$][\w$]*\s*=/, "globalThis mutation"],
		[/\bcreateRequire\s*\(/, "createRequire"],
		[/(^|[^.\w$])require\s*\(/, "require()"],
	];
	for (const file of files) {
		for (const [pattern, label] of patterns) {
			if (pattern.test(file.text)) fail(`${file.path}: core patching/dynamic loading is forbidden (${label})`);
		}
	}
}

function assertProductGuardrails(files: SourceFile[]): void {
	const forbidden: Array<[RegExp, string]> = [
		[/\bthemeMode\b/, "themeMode"],
		[/\bFOLLOW_PI_THEME_ID\b/, "FOLLOW_PI_THEME_ID"],
		[/\btheme\s*:\s*["']pi["']/, 'theme: "pi"'],
		[/\btheme\s*:\s*["']auto["']/, 'theme: "auto"'],
		[/ctx\.ui\.setTheme\s*\(/, "ctx.ui.setTheme()"],
		[/getAllThemes\s*\(/, "getAllThemes()"],
		[/getTheme\s*\(/, "getTheme()"],
		[/setTheme\s*\(/, "setTheme()"],
		[/resolvePiThemeStyles|createPiRenderStyleContext|enablePiThemeStyles|readPiUiTheme|PiThemeLike|PiThemeColorToken|PiThemeStyleOptions/, "deleted Pi style seam"],
		[/sessionManager\.getBranch\s*\(/, "production sessionManager.getBranch()"],
	];
	assert.equal(files.some((file) => file.path === "render-style-context.ts"), false, "deleted render-style-context.ts must not return");
	for (const file of files) {
		for (const [pattern, label] of forbidden) {
			if (pattern.test(file.text)) fail(`${file.path}: forbidden product path ${label}`);
		}
	}
}

function assertRenderPathsStayIoFree(files: SourceFile[]): void {
	const callPatterns: Array<[RegExp, string]> = [
		[/\bfetch\s*\(/, "fetch"],
		[/\bexec(?:File)?\s*\(/, "exec"],
		[/\bspawn\s*\(/, "spawn"],
		[/\breadFile\s*\(/, "readFile"],
		[/\bwriteFile\s*\(/, "writeFile"],
		[/\breaddir\s*\(/, "readdir"],
		[/\bcreate(?:Read|Write)Stream\s*\(/, "stream IO"],
	];
	for (const file of files.filter((candidate) => RENDER_MODULES.has(candidate.path) || candidate.path.endsWith("-segment-feature.ts"))) {
		for (const record of importsFrom(file)) {
			if (IO_NETWORK_PROCESS_IMPORTS.has(record.specifier)) fail(`${file.path}: render path imports ${record.specifier}`);
		}
		for (const [pattern, label] of callPatterns) {
			if (pattern.test(file.text)) fail(`${file.path}: render path performs ${label}`);
		}
	}
}

function assertHighValueImportRules(files: SourceFile[]): void {
	const index = files.find((file) => file.path === "index.ts");
	assert.ok(index, "index.ts should exist");
	const allowedIndexImports = new Set(["@earendil-works/pi-coding-agent", "./config.js", "./pane.js", "./runtime.js"]);
	for (const record of importsFrom(index)) {
		if (!allowedIndexImports.has(record.specifier)) fail(`index.ts: thin wiring must not import ${record.specifier}`);
		if (record.specifier === "@earendil-works/pi-coding-agent" && !record.typeOnly) fail("index.ts: Pi import must stay type-only");
	}

	const state = files.find((file) => file.path === "state.ts");
	assert.ok(state, "state.ts should exist");
	for (const record of importsFrom(state)) {
		if (record.specifier.startsWith("@earendil-works/pi-")) fail(`state.ts: pure state must not import ${record.specifier}`);
	}

	const runtime = files.find((file) => file.path === "runtime.ts");
	assert.ok(runtime, "runtime.ts should exist");
	const forbiddenRuntimeImports = new Set(["./input-surface-frame.js", "./surface-layout.js", "./status-line.js", "./renderer.js", "./pane.js", "./segments.js", "./state.js", "./runtime-snapshot.js"]);
	for (const record of importsFrom(runtime)) {
		if (forbiddenRuntimeImports.has(record.specifier)) fail(`runtime.ts: orchestration must not import ${record.specifier}`);
	}
}

function assertNativeTestRunner(packageText: string): void {
	const manifest = JSON.parse(packageText) as { scripts?: Record<string, string> };
	const testDev = manifest.scripts?.["test:dev"] ?? "";
	assert.ok(testDev.includes("node --test"), "test:dev should use Node's native test runner");
	assert.ok(testDev.includes("--test-concurrency=4"), "test:dev should cap concurrency at four processes");
	assert.ok(testDev.includes(".tmp-git-dev/scripts/test-*.js"), "test:dev should discover compiled tests through one glob");
}

const files = await readRootSourceFiles();
const packageText = await readFile(join(ROOT, "package.json"), "utf8");
const lockText = await readFile(join(ROOT, "package-lock.json"), "utf8");

assert.equal(files.some((file) => file.text.includes(LEGACY_NAMESPACE)), false, "production source must not contain the legacy Pi namespace");
assertCompatibilityBaseline(packageText, lockText);
assertPublicPiImports(files);
assertNoCorePatching(files);
assertProductGuardrails(files);
assertRenderPathsStayIoFree(files);
assertHighValueImportRules(files);
assertNativeTestRunner(packageText);

console.log("✓ public dependency and product guardrails passed");
