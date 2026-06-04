import { strict as assert } from "node:assert";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

const ROOT = process.cwd();
const ALLOWED_PI_IMPORTS = new Set([
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
]);
const RENDER_MODULES = new Set(["editor.ts", "renderer.ts", "pane.ts", "segments.ts", "surface-layout.ts"]);
const INDEX_MODULE = "index.ts";
const PURE_CONFIG_OPTIONS_MODULE = "config-options.ts";
const RUNTIME_SNAPSHOT_MODULE = "runtime-snapshot.ts";
const STATE_MODULE = "state.ts";
const SURFACE_LAYOUT_MODULE = "surface-layout.ts";
const SETTINGS_CATALOG_MODULE = "settings-catalog.ts";
const GUARD_SCRIPT = join("scripts", "test-boundaries.ts");
const LEGACY_NAMESPACE = ["@mariozechner", ""].join("/");

interface SourceFile {
	path: string;
	text: string;
}

async function readSourceFiles(): Promise<SourceFile[]> {
	const rootEntries = await readdir(ROOT, { withFileTypes: true });
	const rootTs = rootEntries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
		.map((entry) => entry.name);

	const scriptEntries = await readdir(join(ROOT, "scripts"), { withFileTypes: true });
	const scriptTs = scriptEntries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
		.map((entry) => join("scripts", entry.name));

	return Promise.all(
		[...rootTs, ...scriptTs].map(async (path) => ({
			path,
			text: await readFile(join(ROOT, path), "utf8"),
		})),
	);
}

async function readText(path: string): Promise<string> {
	return readFile(join(ROOT, path), "utf8");
}

function fail(message: string): never {
	assert.fail(message);
}

function assertNoLegacyNamespace(files: SourceFile[]): void {
	for (const file of files) {
		const index = file.text.indexOf(LEGACY_NAMESPACE);
		if (index >= 0) fail(`${file.path}: legacy namespace is not allowed`);
	}
}

function assertNoLegacyPiPackages(packageFiles: SourceFile[]): void {
	const legacyPiPackage = /@mariozechner\/pi-(?:ai|coding-agent|tui)/;
	for (const file of packageFiles) {
		if (legacyPiPackage.test(file.text)) fail(`${file.path}: legacy pi package namespace is not allowed`);
	}
}

function assertPublicPiImports(files: SourceFile[]): void {
	const importPattern = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const file of files) {
		for (const match of file.text.matchAll(importPattern)) {
			const specifier = match[1]!;
			if (specifier.startsWith(LEGACY_NAMESPACE)) {
				fail(`${file.path}: legacy pi import ${specifier}`);
			}
			if (!specifier.startsWith("@earendil-works/pi-")) continue;
			if (!ALLOWED_PI_IMPORTS.has(specifier)) {
				fail(`${file.path}: private/deep or unsupported pi import ${specifier}`);
			}
		}
	}
}

function assertNoCorePatching(files: SourceFile[]): void {
	const patterns: Array<[RegExp, string]> = [
		[/\bObject\.definePropert(?:y|ies)\s*\(/, "Object.defineProperty/defineProperties"],
		[/\bReflect\.defineProperty\s*\(/, "Reflect.defineProperty"],
		[/\bObject\.setPrototypeOf\s*\(/, "Object.setPrototypeOf"],
		[/__proto__/, "__proto__ mutation"],
		[/\.prototype(?:\.[A-Za-z_$][\w$]*)?\s*=/, "prototype mutation"],
		[/\bglobalThis\.[A-Za-z_$][\w$]*\s*=/, "globalThis mutation"],
		[/\bcreateRequire\s*\(/, "createRequire"],
		[/(^|[^.\w$])require\s*\(/, "require()"],
	];

	for (const file of files.filter((candidate) => candidate.path !== GUARD_SCRIPT)) {
		for (const [pattern, label] of patterns) {
			if (pattern.test(file.text)) fail(`${file.path}: core-patching/dynamic import pattern is not allowed (${label})`);
		}
	}
}

function assertSurfaceLayoutSeamImports(files: SourceFile[]): void {
	const surfaceLayout = files.find((candidate) => basename(candidate.path) === SURFACE_LAYOUT_MODULE);
	if (!surfaceLayout) return;
	const forbiddenModulePattern = /(?:^|\/)(?:renderer|editor|pane)(?:\.js)?$/;
	const importPattern = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of surfaceLayout.text.matchAll(importPattern)) {
		const specifier = match[1]!;
		if (forbiddenModulePattern.test(specifier)) {
			fail(`${surfaceLayout.path}: surface-layout seam must not import ${specifier}`);
		}
	}
}

function assertSettingsCatalogSeamImports(files: SourceFile[]): void {
	const settingsCatalog = files.find((candidate) => basename(candidate.path) === SETTINGS_CATALOG_MODULE);
	if (!settingsCatalog) return;
	const forbiddenModulePattern = /(?:^|\/)(?:renderer|editor|pane|surface-layout)(?:\.js)?$/;
	const importPattern = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of settingsCatalog.text.matchAll(importPattern)) {
		const specifier = match[1]!;
		if (forbiddenModulePattern.test(specifier) || specifier.startsWith("@earendil-works/pi-")) {
			fail(`${settingsCatalog.path}: settings-catalog seam must not import runtime/rendering module ${specifier}`);
		}
	}
}

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

function assertRenderModulesHaveNoIo(files: SourceFile[]): void {
	const importPattern = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	const callPatterns: Array<[RegExp, string]> = [
		[/\bfetch\s*\(/, "fetch()"],
		[/\bXMLHttpRequest\b/, "XMLHttpRequest"],
		[/\bWebSocket\b/, "WebSocket"],
		[/\bexec(?:File)?\s*\(/, "exec/execFile"],
		[/\bspawn\s*\(/, "spawn"],
		[/\bfork\s*\(/, "fork"],
		[/\breadFile\s*\(/, "readFile"],
		[/\bwriteFile\s*\(/, "writeFile"],
		[/\bmkdir\s*\(/, "mkdir"],
		[/\breaddir\s*\(/, "readdir"],
		[/\bstat\s*\(/, "stat"],
		[/\bcreateReadStream\s*\(/, "createReadStream"],
		[/\bcreateWriteStream\s*\(/, "createWriteStream"],
	];

	for (const file of files.filter((candidate) => RENDER_MODULES.has(basename(candidate.path)) || basename(candidate.path) === SETTINGS_CATALOG_MODULE)) {
		for (const match of file.text.matchAll(importPattern)) {
			const specifier = match[1]!;
			if (IO_NETWORK_PROCESS_IMPORTS.has(specifier)) fail(`${file.path}: render module must not import IO/network/process module ${specifier}`);
		}
		for (const [pattern, label] of callPatterns) {
			if (pattern.test(file.text)) fail(`${file.path}: render module must not perform render-time IO/network/process work (${label})`);
		}
	}
}

function assertRuntimeSnapshotAdapterSeam(files: SourceFile[]): void {
	const runtimeSnapshot = files.find((candidate) => basename(candidate.path) === RUNTIME_SNAPSHOT_MODULE);
	assert.ok(runtimeSnapshot, "runtime-snapshot.ts state input adapter seam should exist");

	const forbiddenRenderModulePattern = /(?:^|\/)(?:editor|renderer|pane|segments|surface-layout)(?:\.js)?$/;
	const importPattern = /import\s+(type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of runtimeSnapshot.text.matchAll(importPattern)) {
		const isTypeOnly = match[1] === "type ";
		const specifier = match[2]!;
		if (specifier.startsWith("@earendil-works/pi-")) {
			if (specifier !== "@earendil-works/pi-coding-agent") fail(`${runtimeSnapshot.path}: runtime-snapshot may only import public pi coding-agent types, not ${specifier}`);
			if (!isTypeOnly) fail(`${runtimeSnapshot.path}: pi coding-agent import must be type-only`);
			continue;
		}
		if (IO_NETWORK_PROCESS_IMPORTS.has(specifier)) fail(`${runtimeSnapshot.path}: runtime-snapshot must not import IO/network/process module ${specifier}`);
		if (forbiddenRenderModulePattern.test(specifier)) fail(`${runtimeSnapshot.path}: runtime-snapshot must not import render module ${specifier}`);
	}
}

function assertStateModulePiFree(files: SourceFile[]): void {
	const state = files.find((candidate) => basename(candidate.path) === STATE_MODULE);
	assert.ok(state, "state.ts should exist");

	const importPattern = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of state.text.matchAll(importPattern)) {
		const specifier = match[1]!;
		if (specifier.startsWith("@earendil-works/pi-")) fail(`${state.path}: state module must not import pi package ${specifier}`);
	}
}

function assertIndexThinWiring(files: SourceFile[]): void {
	const index = files.find((candidate) => basename(candidate.path) === INDEX_MODULE);
	assert.ok(index, "index.ts should exist");

	const allowedSpecifiers = new Set(["@earendil-works/pi-coding-agent", "./config.js", "./pane.js", "./runtime.js"]);
	const importPattern = /import\s+(type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of index.text.matchAll(importPattern)) {
		const isTypeOnly = match[1] === "type ";
		const specifier = match[2]!;
		if (!allowedSpecifiers.has(specifier)) fail(`${index.path}: thin extension wiring must not import ${specifier}`);
		if (specifier === "@earendil-works/pi-coding-agent" && !isTypeOnly) fail(`${index.path}: pi coding-agent import must be type-only`);
	}
}

function assertConfigOptionsPureModule(files: SourceFile[]): void {
	const configOptions = files.find((candidate) => basename(candidate.path) === PURE_CONFIG_OPTIONS_MODULE);
	assert.ok(configOptions, "config-options.ts pure option source should exist");

	const forbiddenLocalModules = new Set(["./config.js", "./settings-catalog.js", "./pane.js", "./editor.js", "./renderer.js", "./surface-layout.js"]);
	const importPattern = /import\s+(type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of configOptions.text.matchAll(importPattern)) {
		const isTypeOnly = match[1] === "type ";
		const specifier = match[2]!;
		if (specifier === "./types.js") {
			if (!isTypeOnly) fail(`${configOptions.path}: config-options may only type-import from ./types.js`);
			continue;
		}
		if (specifier.startsWith("@earendil-works/pi-")) fail(`${configOptions.path}: pure option source must not import pi package ${specifier}`);
		if (IO_NETWORK_PROCESS_IMPORTS.has(specifier)) fail(`${configOptions.path}: pure option source must not import IO/network/process module ${specifier}`);
		if (forbiddenLocalModules.has(specifier)) fail(`${configOptions.path}: pure option source must not import runtime/config/catalog module ${specifier}`);
		fail(`${configOptions.path}: pure option source must not import ${specifier}`);
	}
}

const sourceFiles = await readSourceFiles();
const packageFiles: SourceFile[] = [
	{ path: "package.json", text: await readText("package.json") },
	{ path: "package-lock.json", text: await readText("package-lock.json") },
];

assertNoLegacyNamespace(sourceFiles);
assertNoLegacyPiPackages(packageFiles);
assertPublicPiImports(sourceFiles);
assertNoCorePatching(sourceFiles);
assertSurfaceLayoutSeamImports(sourceFiles);
assertSettingsCatalogSeamImports(sourceFiles);
assertRenderModulesHaveNoIo(sourceFiles);
assertRuntimeSnapshotAdapterSeam(sourceFiles);
assertStateModulePiFree(sourceFiles);
assertIndexThinWiring(sourceFiles);
assertConfigOptionsPureModule(sourceFiles);

console.log("✓ public import and render-boundary guard checks passed");
