import { strict as assert } from "node:assert";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

const ROOT = process.cwd();
const ALLOWED_PI_IMPORTS = new Set([
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
]);
const FOOTER_MODULE = "footer.ts";
const STATUS_LINE_MODULE = "status-line.ts";
const RENDER_MODULES = new Set(["editor.ts", "renderer.ts", "pane.ts", "segments.ts", "surface-layout.ts", FOOTER_MODULE, STATUS_LINE_MODULE]);
const INDEX_MODULE = "index.ts";
const PURE_CONFIG_OPTIONS_MODULE = "config-options.ts";
const RUNTIME_POLICY_MODULE = "runtime-policy.ts";
const RUNTIME_SNAPSHOT_MODULE = "runtime-snapshot.ts";
const STATE_MODULE = "state.ts";
const SURFACE_LAYOUT_MODULE = "surface-layout.ts";
const SETTINGS_CATALOG_MODULE = "settings-catalog.ts";
const PANE_MODEL_MODULE = "pane-model.ts";
const THEME_ADAPTER_MODULE = "theme-adapter.ts";
const RENDER_STYLE_CONTEXT_MODULE = "render-style-context.ts";
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

function assertThemeAdapterSeamImports(files: SourceFile[]): void {
	const themeAdapter = files.find((candidate) => basename(candidate.path) === THEME_ADAPTER_MODULE);
	assert.ok(themeAdapter, "theme-adapter.ts pure style adapter seam should exist");

	const allowedLocalSpecifiers = new Set(["./palette.js", "./themes.js", "./types.js"]);
	const forbiddenLocalModulePattern = /(?:^|\/)(?:runtime|runtime-snapshot|state|config|config-options|settings-catalog|pane|pane-model|editor|renderer|status-line|surface-layout|footer)(?:\.js)?$/;
	const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of themeAdapter.text.matchAll(importPattern)) {
		const specifier = match[1]!;
		if (specifier.startsWith("@earendil-works/pi-")) fail(`${themeAdapter.path}: theme adapter must not import pi package ${specifier}`);
		if (IO_NETWORK_PROCESS_IMPORTS.has(specifier)) fail(`${themeAdapter.path}: theme adapter must not import IO/network/process module ${specifier}`);
		if (forbiddenLocalModulePattern.test(specifier)) fail(`${themeAdapter.path}: theme adapter must not import runtime/render/UI module ${specifier}`);
		if (specifier.startsWith(".") && !allowedLocalSpecifiers.has(specifier)) fail(`${themeAdapter.path}: theme adapter may only import palette/theme/types helpers, not ${specifier}`);
		if (!specifier.startsWith(".")) fail(`${themeAdapter.path}: theme adapter must not import external module ${specifier}`);
	}
	if (!themeAdapter.text.includes("interface GlanceRenderStyleContext")) fail(`${themeAdapter.path}: theme adapter should expose a shared render style context seam`);
	if (!themeAdapter.text.includes("resolveGlanceRenderStyles")) fail(`${themeAdapter.path}: theme adapter should expose a shared render style resolver`);
	if (!themeAdapter.text.includes("interface PiThemeLike")) fail(`${themeAdapter.path}: theme adapter should expose a structural Pi theme-like style source skeleton`);
	if (!themeAdapter.text.includes("resolvePiThemeStyles")) fail(`${themeAdapter.path}: theme adapter should expose an adapter-only Pi theme style resolver`);
}

function assertPiThemeResolverAdapterOnly(files: SourceFile[]): void {
	const allowed = new Set([THEME_ADAPTER_MODULE, RENDER_STYLE_CONTEXT_MODULE, GUARD_SCRIPT, join("scripts", "test-themes.ts")]);
	for (const file of files) {
		if (allowed.has(file.path)) continue;
		if (/resolvePiThemeStyles|PiThemeLike|PiThemeColorToken/.test(file.text)) {
			fail(`${file.path}: Pi theme style resolver skeleton must remain adapter/provider/test-only in this slice`);
		}
	}
}

function assertRenderStyleContextSeam(files: SourceFile[]): void {
	const renderStyleContext = files.find((candidate) => basename(candidate.path) === RENDER_STYLE_CONTEXT_MODULE);
	assert.ok(renderStyleContext, "render-style-context.ts inactive runtime style provider seam should exist");

	const allowedSpecifiers = new Set(["./theme-adapter.js", "./types.js"]);
	const importPattern = /(?:import|export)\s+(type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of renderStyleContext.text.matchAll(importPattern)) {
		const specifier = match[2]!;
		if (specifier.startsWith("@earendil-works/pi-")) fail(`${renderStyleContext.path}: provider seam must not import pi package ${specifier}`);
		if (IO_NETWORK_PROCESS_IMPORTS.has(specifier)) fail(`${renderStyleContext.path}: provider seam must not import IO/network/process module ${specifier}`);
		if (!allowedSpecifiers.has(specifier)) fail(`${renderStyleContext.path}: provider seam must not import ${specifier}`);
	}
	if (!renderStyleContext.text.includes("createPiRenderStyleContext")) fail(`${renderStyleContext.path}: provider seam should expose Pi theme to GlanceRenderStyleContext conversion`);
	if (!renderStyleContext.text.includes("resolveRuntimeRenderStyleContext")) fail(`${renderStyleContext.path}: provider seam should expose inactive runtime context resolver`);
	if (!renderStyleContext.text.includes("enablePiThemeStyles")) fail(`${renderStyleContext.path}: runtime Pi style activation should require an explicit future enable flag`);
	if (/getAllThemes|getTheme\s*\(|setTheme\s*\(/.test(renderStyleContext.text)) fail(`${renderStyleContext.path}: provider seam must not enumerate, load, or set Pi themes`);
}

function assertPiThemeRuntimeProviderBoundary(files: SourceFile[]): void {
	const runtime = files.find((candidate) => basename(candidate.path) === "runtime.ts");
	assert.ok(runtime, "runtime.ts should exist");
	if (!runtime.text.includes("./render-style-context.js")) fail(`${runtime.path}: runtime should import the inactive render style provider seam`);
	if (!runtime.text.includes("resolveRuntimeRenderStyleContext(activeConfig")) fail(`${runtime.path}: runtime should prepare render style context through the inactive provider seam for editor install`);
	if (!runtime.text.includes("resolveRuntimeRenderStyleContext(current")) fail(`${runtime.path}: runtime should prepare render style context through the inactive provider seam for pane preview`);
	if (!runtime.text.includes("readPiUiTheme(ctx.ui)")) fail(`${runtime.path}: runtime should read the public current UI theme only through the provider seam helper`);
	if (/resolvePiThemeStyles|PiThemeLike|PiThemeColorToken|ctx\.ui\.theme|getAllThemes|getTheme\s*\(|setTheme\s*\(/.test(runtime.text)) {
		fail(`${runtime.path}: runtime must not directly use Pi theme adapters or enumerate/set Pi themes`);
	}

	for (const file of files) {
		if (new Set([RENDER_STYLE_CONTEXT_MODULE, GUARD_SCRIPT]).has(file.path)) continue;
		if (/ctx\.ui\.theme|getAllThemes|getTheme\s*\(|setTheme\s*\(/.test(file.text)) {
			fail(`${file.path}: Pi UI theme APIs must stay limited to the inactive provider seam in this slice`);
		}
	}
}

function assertPanePreviewStyleContextBoundary(files: SourceFile[]): void {
	const pane = files.find((candidate) => basename(candidate.path) === "pane.ts");
	assert.ok(pane, "pane.ts should exist");
	if (!pane.text.includes("GlancePaneOptions")) fail(`${pane.path}: pane should expose optional preview style context options`);
	if (!pane.text.includes("renderStyleContext")) fail(`${pane.path}: pane preview should accept an optional render style context`);
	if (!pane.text.includes("GlanceRenderStyleContext")) fail(`${pane.path}: pane should only depend on the generic render style context type`);
	if (/render-style-context|resolvePiThemeStyles|PiThemeLike|PiThemeColorToken|readPiUiTheme|createPiRenderStyleContext/.test(pane.text)) {
		fail(`${pane.path}: pane must not depend on Pi-specific style providers or resolver types`);
	}
	if (!/renderInputSurface\([\s\S]*?previewOptions/.test(pane.text)) fail(`${pane.path}: runtime-state pane preview should forward preview style context options`);
	if (!/renderInputSurfacePreview\([\s\S]*?previewOptions/.test(pane.text)) fail(`${pane.path}: static pane preview should forward preview style context options`);
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
		"./footer.js",
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

	const allowedSpecifiers = new Set(["@earendil-works/pi-tui", "./palette.js", "./segment-registry.js", "./segments.js", "./theme-adapter.js", "./types.js"]);
	const forbiddenLocalSpecifiers = new Set([
		"./renderer.js",
		"./surface-layout.js",
		"./editor.js",
		"./pane.js",
		"./runtime.js",
		"./runtime-snapshot.js",
		"./state.js",
		"./footer.js",
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
	if (!statusLine.text.includes("resolveGlanceRenderStyles(config.theme")) fail(`${statusLine.path}: status-line styling should resolve styles through the shared adapter context`);
	if (/\bPALETTES\b|(^|[^.\w$])fg\s*\(/.test(statusLine.text)) fail(`${statusLine.path}: status-line must not style through direct palette/fg access after adapter wiring`);
}

function assertRendererSeamImports(files: SourceFile[]): void {
	const renderer = files.find((candidate) => basename(candidate.path) === "renderer.ts");
	assert.ok(renderer, "renderer.ts preview/static render seam should exist");

	const allowedSpecifiers = new Set(["@earendil-works/pi-tui", "./surface-layout.js", "./status-line.js", "./theme-adapter.js", "./types.js"]);
	const forbiddenLocalSpecifiers = new Set([
		"./editor.js",
		"./pane.js",
		"./runtime.js",
		"./runtime-snapshot.js",
		"./state.js",
		"./footer.js",
		"./config.js",
		"./settings-catalog.js",
		"./palette.js",
	]);
	const importPattern = /(?:import|export)\s+(type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of renderer.text.matchAll(importPattern)) {
		const specifier = match[2]!;
		if (specifier.startsWith("@earendil-works/pi-") && specifier !== "@earendil-works/pi-tui") {
			fail(`${renderer.path}: renderer may only import public pi-tui helpers, not ${specifier}`);
		}
		if (IO_NETWORK_PROCESS_IMPORTS.has(specifier)) fail(`${renderer.path}: renderer must not import IO/network/process module ${specifier}`);
		if (forbiddenLocalSpecifiers.has(specifier)) fail(`${renderer.path}: renderer must not import UI/runtime/state/config/palette module ${specifier}`);
		if (!allowedSpecifiers.has(specifier)) fail(`${renderer.path}: renderer must not import ${specifier}`);
	}
	if (!renderer.text.includes("resolveGlanceRenderStyles(config.theme")) fail(`${renderer.path}: renderer styling should resolve styles through the shared adapter context`);
	if (!/renderGlanceLine\([\s\S]*?\{ styles \}/.test(renderer.text)) fail(`${renderer.path}: renderer should pass its resolved styles into status-line rendering`);
	if (/\bPALETTES\b|(^|[^.\w$])fg\s*\(/.test(renderer.text)) fail(`${renderer.path}: renderer must not style through direct palette/fg access after adapter wiring`);
}

function assertEditorSeamImports(files: SourceFile[]): void {
	const editor = files.find((candidate) => basename(candidate.path) === "editor.ts");
	assert.ok(editor, "editor.ts live input surface seam should exist");

	const allowedSpecifiers = new Set(["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "./format.js", "./status-line.js", "./surface-layout.js", "./theme-adapter.js", "./types.js"]);
	const forbiddenLocalSpecifiers = new Set([
		"./renderer.js",
		"./pane.js",
		"./runtime.js",
		"./runtime-snapshot.js",
		"./state.js",
		"./footer.js",
		"./config.js",
		"./settings-catalog.js",
		"./palette.js",
	]);
	const importPattern = /(?:import|export)\s+(type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of editor.text.matchAll(importPattern)) {
		const specifier = match[2]!;
		if (specifier.startsWith("@earendil-works/pi-") && specifier !== "@earendil-works/pi-coding-agent" && specifier !== "@earendil-works/pi-tui") {
			fail(`${editor.path}: editor may only import public pi coding-agent/pi-tui helpers, not ${specifier}`);
		}
		if (IO_NETWORK_PROCESS_IMPORTS.has(specifier)) fail(`${editor.path}: editor must not import IO/network/process module ${specifier}`);
		if (forbiddenLocalSpecifiers.has(specifier)) fail(`${editor.path}: editor must not import UI/runtime/state/config/palette module ${specifier}`);
		if (!allowedSpecifiers.has(specifier)) fail(`${editor.path}: editor must not import ${specifier}`);
	}
	if (!editor.text.includes("resolveGlanceRenderStyles(config.theme")) fail(`${editor.path}: editor styling should resolve styles through the shared adapter context`);
	if (!/renderGlanceLine\([\s\S]*?\{ styles \}/.test(editor.text)) fail(`${editor.path}: editor should pass its render-pass styles into status-line rendering`);
	if (!editor.text.includes("cachedStatusStyleKey") || !editor.text.includes("styles.cacheKey")) fail(`${editor.path}: editor status cache should include style cacheKey awareness`);
	if (!/handleInput\(data: string\): void\s*{[\s\S]*?super\.handleInput\(data\)/.test(editor.text)) fail(`${editor.path}: GlanceEditor.handleInput must continue delegating raw input to CustomEditor`);
	if (editor.text.includes("interface GlanceEditorOptions extends EditorOptions")) fail(`${editor.path}: GlanceEditorOptions must not extend Pi EditorOptions; keep pi-glance render options separate`);
	if (!editor.text.includes("readonly editorOptions?: EditorOptions") || !editor.text.includes("readonly renderStyleContext?: GlanceRenderStyleContext")) fail(`${editor.path}: GlanceEditorOptions should wrap Pi editorOptions separately from renderStyleContext`);
	if (!editor.text.includes("super(tui, theme, appKeybindings, glanceOptions?.editorOptions)")) fail(`${editor.path}: GlanceEditor must pass only editorOptions through to CustomEditor`);
	if (/super\(tui, theme, appKeybindings, glanceOptions\)/.test(editor.text)) fail(`${editor.path}: GlanceEditor must not pass pi-glance renderStyleContext through to CustomEditor`);
	if (/\bPALETTES\b|(^|[^.\w$])fg\s*\(/.test(editor.text)) fail(`${editor.path}: editor must not style through direct palette/fg access after adapter wiring`);
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

function assertFooterSeams(files: SourceFile[]): void {
	const footer = files.find((candidate) => basename(candidate.path) === FOOTER_MODULE);
	assert.ok(footer, "footer.ts explicit empty footer should exist");

	const importPattern = /(?:import|export)\s+(type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	for (const match of footer.text.matchAll(importPattern)) {
		const isTypeOnly = match[1] === "type ";
		const specifier = match[2]!;
		if (specifier !== "@earendil-works/pi-tui") fail(`${footer.path}: footer may only import pi-tui Component type, not ${specifier}`);
		if (!isTypeOnly) fail(`${footer.path}: footer import from ${specifier} must be type-only`);
	}
	if (!/render\(_width: number\): string\[\]\s*{\s*return \[\];\s*}/s.test(footer.text)) fail(`${footer.path}: custom footer should be explicitly empty`);
	if (/getAvailableProviderCount|ReadonlyFooterDataProvider|setProviderCount/.test(footer.text)) fail(`${footer.path}: footer must not be a provider-count data bridge`);
}

function assertProviderCountSnapshotSeam(files: SourceFile[]): void {
	const runtimeSnapshot = files.find((candidate) => basename(candidate.path) === RUNTIME_SNAPSHOT_MODULE);
	assert.ok(runtimeSnapshot, "runtime-snapshot.ts state input adapter seam should exist");
	if (!/modelRegistry[\s\S]*?getAvailable/.test(runtimeSnapshot.text)) fail(`${runtimeSnapshot.path}: provider count should derive from ctx.modelRegistry.getAvailable()`);
	if (!/new Set<string>\(\)/.test(runtimeSnapshot.text)) fail(`${runtimeSnapshot.path}: provider count should deduplicate provider names`);
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
		if (specifier === "./config-schema.js") continue;
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
assertThemeAdapterSeamImports(sourceFiles);
assertPiThemeResolverAdapterOnly(sourceFiles);
assertRenderStyleContextSeam(sourceFiles);
assertPiThemeRuntimeProviderBoundary(sourceFiles);
assertPanePreviewStyleContextBoundary(sourceFiles);
assertRenderModulesHaveNoIo(sourceFiles);
assertRuntimeSnapshotAdapterSeam(sourceFiles);
assertRuntimePolicyPureModule(sourceFiles);
assertStatusLineSeamImports(sourceFiles);
assertRendererSeamImports(sourceFiles);
assertEditorSeamImports(sourceFiles);
assertStatusLineConsumers(sourceFiles);
assertStateModulePiFree(sourceFiles);
assertFooterSeams(sourceFiles);
assertProviderCountSnapshotSeam(sourceFiles);
assertIndexThinWiring(sourceFiles);
assertConfigOptionsPureModule(sourceFiles);

console.log("✓ public import and render-boundary guard checks passed");
