import { strict as assert } from "node:assert";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

const ROOT = process.cwd();
const ALLOWED_PI_IMPORTS = new Set([
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
]);
const FOOTER_BRIDGE_MODULE = "footer-bridge.ts";
const STATUS_LINE_MODULE = "status-line.ts";
const RENDER_MODULES = new Set(["editor.ts", "renderer.ts", "pane.ts", "segments.ts", "surface-layout.ts", FOOTER_BRIDGE_MODULE, STATUS_LINE_MODULE]);
const INDEX_MODULE = "index.ts";
const PURE_CONFIG_OPTIONS_MODULE = "config-options.ts";
const RUNTIME_POLICY_MODULE = "runtime-policy.ts";
const RUNTIME_SNAPSHOT_MODULE = "runtime-snapshot.ts";
const STATE_MODULE = "state.ts";
const SURFACE_LAYOUT_MODULE = "surface-layout.ts";
const SETTINGS_CATALOG_MODULE = "settings-catalog.ts";
const PANE_MODEL_MODULE = "pane-model.ts";
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
	const forbiddenModulePattern = /(?:^|\/)(?:renderer|editor|pane|status-line)(?:\.js)?$/;
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
	const forbiddenModulePattern = /(?:^|\/)(?:renderer|editor|pane|pane-model|surface-layout)(?:\.js)?$/;
	const importPattern = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of settingsCatalog.text.matchAll(importPattern)) {
		const specifier = match[1]!;
		if (forbiddenModulePattern.test(specifier) || specifier.startsWith("@earendil-works/pi-")) {
			fail(`${settingsCatalog.path}: settings-catalog seam must not import runtime/render/model module ${specifier}`);
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

function assertPaneModelSeamImports(files: SourceFile[]): void {
	const paneModel = files.find((candidate) => basename(candidate.path) === PANE_MODEL_MODULE);
	assert.ok(paneModel, "pane-model.ts pure model seam should exist");

	const allowedLocalSpecifiers = new Set(["./config.js", "./settings-catalog.js", "./types.js"]);
	const forbiddenLocalModulePattern = /(?:^|\/)(?:pane|editor|renderer|surface-layout)(?:\.js)?$/;
	const importPattern = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of paneModel.text.matchAll(importPattern)) {
		const specifier = match[1]!;
		if (specifier.startsWith("@earendil-works/pi-")) fail(`${paneModel.path}: pane-model seam must not import pi package ${specifier}`);
		if (IO_NETWORK_PROCESS_IMPORTS.has(specifier)) fail(`${paneModel.path}: pane-model seam must not import IO/network/process module ${specifier}`);
		if (forbiddenLocalModulePattern.test(specifier)) fail(`${paneModel.path}: pane-model seam must not import render/UI module ${specifier}`);
		if (specifier.startsWith(".") && !allowedLocalSpecifiers.has(specifier)) fail(`${paneModel.path}: pane-model seam may only import pure helpers/types, not ${specifier}`);
	}
}

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

function assertRuntimePolicyPureModule(files: SourceFile[]): void {
	const runtimePolicy = files.find((candidate) => basename(candidate.path) === RUNTIME_POLICY_MODULE);
	assert.ok(runtimePolicy, "runtime-policy.ts pure policy table should exist");

	const forbiddenLocalModules = new Set([
		"./runtime.js",
		"./runtime-snapshot.js",
		"./state.js",
		"./editor.js",
		"./renderer.js",
		"./pane.js",
		"./footer-bridge.js",
		"./git.js",
		"./config.js",
	]);
	const importPattern = /(?:import|export)\s+(type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of runtimePolicy.text.matchAll(importPattern)) {
		const specifier = match[2]!;
		if (specifier.startsWith("@earendil-works/pi-")) fail(`${runtimePolicy.path}: runtime policy must not import pi/TUI package ${specifier}`);
		if (IO_NETWORK_PROCESS_IMPORTS.has(specifier)) fail(`${runtimePolicy.path}: runtime policy must not import IO/network/process module ${specifier}`);
		if (forbiddenLocalModules.has(specifier)) fail(`${runtimePolicy.path}: runtime policy must not import runtime/state/render/config module ${specifier}`);
		fail(`${runtimePolicy.path}: runtime policy table should be import-free, found ${specifier}`);
	}
}

function assertStatusLineSeamImports(files: SourceFile[]): void {
	const statusLine = files.find((candidate) => basename(candidate.path) === STATUS_LINE_MODULE);
	assert.ok(statusLine, "status-line.ts render seam should exist");

	const allowedSpecifiers = new Set(["@earendil-works/pi-tui", "./palette.js", "./segment-registry.js", "./segments.js", "./types.js"]);
	const forbiddenLocalSpecifiers = new Set([
		"./renderer.js",
		"./surface-layout.js",
		"./editor.js",
		"./pane.js",
		"./runtime.js",
		"./runtime-snapshot.js",
		"./state.js",
		"./footer-bridge.js",
		"./config.js",
		"./settings-catalog.js",
	]);
	const importPattern = /(?:import|export)\s+(type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of statusLine.text.matchAll(importPattern)) {
		const specifier = match[2]!;
		if (specifier.startsWith("@earendil-works/pi-") && specifier !== "@earendil-works/pi-tui") {
			fail(`${statusLine.path}: status-line may only import public pi-tui helpers, not ${specifier}`);
		}
		if (IO_NETWORK_PROCESS_IMPORTS.has(specifier)) fail(`${statusLine.path}: status-line must not import IO/network/process module ${specifier}`);
		if (forbiddenLocalSpecifiers.has(specifier)) fail(`${statusLine.path}: status-line must not import UI/runtime/state/config module ${specifier}`);
		if (!allowedSpecifiers.has(specifier)) fail(`${statusLine.path}: status-line must not import ${specifier}`);
	}
}

function assertStatusLineConsumers(files: SourceFile[]): void {
	const renderer = files.find((candidate) => basename(candidate.path) === "renderer.ts");
	assert.ok(renderer, "renderer.ts should exist");
	const editor = files.find((candidate) => basename(candidate.path) === "editor.ts");
	assert.ok(editor, "editor.ts should exist");

	const importPattern = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	const rendererImports = [...renderer.text.matchAll(importPattern)].map((match) => match[1]!);
	if (rendererImports.includes("./segments.js")) fail(`${renderer.path}: renderer must not import ./segments.js after status-line split`);
	if (rendererImports.includes("./segment-registry.js")) fail(`${renderer.path}: renderer must not import ./segment-registry.js after status-line split`);
	assert.ok(rendererImports.includes("./status-line.js"), "renderer.ts should import status-line seam for renderGlanceLine");

	const editorImports = [...editor.text.matchAll(importPattern)].map((match) => match[1]!);
	if (editorImports.includes("./renderer.js")) fail(`${editor.path}: editor must not import renderGlanceLine from renderer after status-line split`);
	assert.ok(editorImports.includes("./status-line.js"), "editor.ts should import renderGlanceLine from status-line seam");
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

function assertFooterBridgeProviderSeam(files: SourceFile[]): void {
	const footerBridge = files.find((candidate) => basename(candidate.path) === FOOTER_BRIDGE_MODULE);
	assert.ok(footerBridge, "footer-bridge.ts provider facts bridge should exist");

	const importPattern = /(?:import|export)\s+(type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	const allowedSpecifiers = new Set(["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "./state.js", "./types.js"]);
	for (const match of footerBridge.text.matchAll(importPattern)) {
		const isTypeOnly = match[1] === "type ";
		const specifier = match[2]!;
		if (!allowedSpecifiers.has(specifier)) fail(`${footerBridge.path}: footer bridge must only import provider/component types and state provider-count seam, not ${specifier}`);
		if ((specifier === "@earendil-works/pi-coding-agent" || specifier === "@earendil-works/pi-tui" || specifier === "./types.js") && !isTypeOnly) {
			fail(`${footerBridge.path}: footer bridge import from ${specifier} must be type-only`);
		}
	}
	if (!/setProviderCount\s*\(\s*this\.getState\(\)\s*,\s*this\.footerData\.getAvailableProviderCount\(\)\s*\)/.test(footerBridge.text)) {
		fail(`${footerBridge.path}: footer bridge sync should delegate provider count facts to setProviderCount()`);
	}
	if (/\.version\s*(?:\+\+|=|\+=)/.test(footerBridge.text)) fail(`${footerBridge.path}: footer bridge must not mutate state.version directly`);
	if (/providers\.availableCount\s*=/.test(footerBridge.text)) fail(`${footerBridge.path}: footer bridge must not mutate provider count directly`);
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
assertPaneModelSeamImports(sourceFiles);
assertRenderModulesHaveNoIo(sourceFiles);
assertRuntimeSnapshotAdapterSeam(sourceFiles);
assertRuntimePolicyPureModule(sourceFiles);
assertStatusLineSeamImports(sourceFiles);
assertStatusLineConsumers(sourceFiles);
assertStateModulePiFree(sourceFiles);
assertFooterBridgeProviderSeam(sourceFiles);
assertIndexThinWiring(sourceFiles);
assertConfigOptionsPureModule(sourceFiles);

console.log("✓ public import and render-boundary guard checks passed");
