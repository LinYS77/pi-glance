import { strict as assert } from "node:assert";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../config.js";
import { createGlanceRuntime, type CreateGitRefresherOptions, type GlancePaneResult, type GlanceRuntimeAdapters, type RuntimeGitRefresher } from "../runtime.js";
import type { GitSnapshot, GlanceConfig } from "../types.js";

interface Notification {
	message: string;
	type: "info" | "warning" | "error" | undefined;
}

type CapturedFooterFactory = (tui: { requestRender(): void }, theme: unknown) => unknown;
type CapturedEditorFactory = (tui: { terminal: { rows: number }; requestRender(): void }, theme: unknown, keybindings: unknown) => unknown;

interface TestContext {
	ctx: ExtensionCommandContext;
	surfaceCalls: string[];
	notifications: Notification[];
	footerFactories: CapturedFooterFactory[];
	editorFactories: CapturedEditorFactory[];
	getRenderRequests(): number;
	setCwd(cwd: string): void;
}

interface GitRefresherHarness {
	create: (options: CreateGitRefresherOptions) => RuntimeGitRefresher;
	created: number;
	schedules: Array<boolean | undefined>;
	disposeCount: number;
	options?: CreateGitRefresherOptions;
}

interface RuntimeHarnessOptions {
	loadConfigSyncConfig?: GlanceConfig;
	loadConfigConfig?: GlanceConfig;
	showPaneResults?: GlancePaneResult[];
	saveConfigError?: Error;
	git?: GitRefresherHarness;
}

interface RuntimeHarness {
	runtime: ReturnType<typeof createGlanceRuntime>;
	showPaneInitials: GlanceConfig[];
	savedConfigs: GlanceConfig[];
	getLoadConfigCalls(): number;
}

function cloneConfig(config: GlanceConfig): GlanceConfig {
	return JSON.parse(JSON.stringify(config)) as GlanceConfig;
}

function disabledConfig(config = defaultConfig()): GlanceConfig {
	const next = cloneConfig(config);
	next.enabled = false;
	return next;
}

function nextEnabledConfig(config = defaultConfig()): GlanceConfig {
	const next = cloneConfig(config);
	next.enabled = true;
	next.git.pollIntervalMs = config.git.pollIntervalMs + 1234;
	next.display.adaptive = !config.display.adaptive;
	return next;
}

function gitSnapshot(branch = "main"): GitSnapshot {
	return {
		repo: true,
		branch,
		detached: false,
		sha: "abcdef1",
		upstream: null,
		ahead: 0,
		behind: 0,
		staged: 0,
		unstaged: 1,
		untracked: 0,
		conflicts: 0,
		dirty: true,
		status: "dirty",
		updatedAt: 1000,
	};
}

function hasNotification(notifications: Notification[], message: string, type: Notification["type"]): boolean {
	return notifications.some((notification) => notification.message === message && notification.type === type);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function createGitHarness(): GitRefresherHarness {
	const harness: GitRefresherHarness = {
		created: 0,
		schedules: [],
		disposeCount: 0,
		create: (options) => {
			harness.created++;
			harness.options = options;
			return {
				schedule: (immediate?: boolean) => harness.schedules.push(immediate),
				dispose: () => {
					harness.disposeCount++;
				},
			};
		},
	};
	return harness;
}

function createContext(options: { cwd?: string; mode?: "tui" | "rpc" | "json" | "print"; hasUI?: boolean; availableProviders?: string[]; invokeFooterFactory?: boolean } = {}): TestContext {
	const surfaceCalls: string[] = [];
	const notifications: Notification[] = [];
	const footerFactories: CapturedFooterFactory[] = [];
	const editorFactories: CapturedEditorFactory[] = [];
	let renderRequests = 0;
	let cwd = options.cwd ?? "/repo";
	const mode = options.mode ?? "tui";
	const hasUI = options.hasUI ?? (mode === "tui" || mode === "rpc");
	const availableProviders = options.availableProviders ?? ["test-provider"];
	const invokeFooterFactory = options.invokeFooterFactory ?? true;
	const fakeTui = { requestRender: () => renderRequests++ };
	const fakeTheme = {};

	const ctx = {
		mode,
		hasUI,
		get cwd() {
			return cwd;
		},
		model: { id: "test-model", provider: "test-provider", contextWindow: 200_000 },
		modelRegistry: {
			getAvailable: () => availableProviders.map((provider) => ({ provider, id: `${provider}-model` })),
		},
		sessionManager: {
			getCwd: () => cwd,
			getEntries: () => [],
			getBranch: () => [],
		},
		ui: {
			notify: (message: string, type?: "info" | "warning" | "error") => notifications.push({ message, type }),
			setFooter: (factory: unknown) => {
				surfaceCalls.push(factory ? "setFooter:install" : "setFooter:clear");
				if (factory) {
					footerFactories.push(factory as CapturedFooterFactory);
					if (invokeFooterFactory) (factory as CapturedFooterFactory)(fakeTui, fakeTheme);
				}
			},
			setEditorComponent: (factory: unknown) => {
				surfaceCalls.push(factory ? "setEditorComponent:install" : "setEditorComponent:clear");
				if (factory) editorFactories.push(factory as CapturedEditorFactory);
			},
		},
		getContextUsage: () => ({ tokens: 42, contextWindow: 200_000, percent: 0.021 }),
	} as unknown as ExtensionCommandContext;

	return {
		ctx,
		surfaceCalls,
		notifications,
		footerFactories,
		editorFactories,
		getRenderRequests: () => renderRequests,
		setCwd: (nextCwd: string) => {
			cwd = nextCwd;
		},
	};
}

function invokeFooterFactory(test: TestContext, index: number, requestRender: () => void): unknown {
	const factory = test.footerFactories[index];
	assert.ok(factory, `expected footer factory ${index}`);
	return factory({ requestRender }, {});
}

function invokeEditorFactory(test: TestContext, index: number, requestRender: () => void): unknown {
	const factory = test.editorFactories[index];
	assert.ok(factory, `expected editor factory ${index}`);
	const editorTheme = {
		borderColor: (text: string) => text,
		selectList: {
			selectedPrefix: (text: string) => text,
			selectedText: (text: string) => text,
			description: (text: string) => text,
			scrollInfo: (text: string) => text,
			noMatch: (text: string) => text,
		},
	};
	const keybindings = { matches: () => false };
	return factory({ terminal: { rows: 40 }, requestRender }, editorTheme, keybindings);
}

function createRuntimeHarness(options: RuntimeHarnessOptions = {}): RuntimeHarness {
	const showPaneInitials: GlanceConfig[] = [];
	const savedConfigs: GlanceConfig[] = [];
	let loadConfigCalls = 0;
	const loadConfigSyncConfig = options.loadConfigSyncConfig ?? defaultConfig();
	const loadConfigConfig = options.loadConfigConfig ?? loadConfigSyncConfig;
	const showPaneResults = [...(options.showPaneResults ?? [])];
	const adapters: GlanceRuntimeAdapters = {
		getThinkingLevel: () => "off",
		loadConfigSync: () => loadConfigSyncConfig,
		loadConfig: async () => {
			loadConfigCalls++;
			return loadConfigConfig;
		},
		saveConfig: async (config) => {
			if (options.saveConfigError) throw options.saveConfigError;
			savedConfigs.push(config);
		},
		showPane: async (initial) => {
			showPaneInitials.push(cloneConfig(initial));
			const result = showPaneResults.shift();
			assert.ok(result, "expected queued showPane result");
			return result;
		},
		createGitRefresher: options.git?.create,
	};
	return {
		runtime: createGlanceRuntime(adapters),
		showPaneInitials,
		savedConfigs,
		getLoadConfigCalls: () => loadConfigCalls,
	};
}

{
	const config = defaultConfig();
	const git = createGitHarness();
	const test = createContext();
	const harness = createRuntimeHarness({ loadConfigSyncConfig: config, git });
	const result = harness.runtime.events.sessionStart({}, test.ctx);

	assert.equal(isPromiseLike(result), false, "sessionStart should stay synchronous for enabled config");
	assert.deepEqual(test.surfaceCalls, ["setFooter:install", "setEditorComponent:install"], "enabled TUI sessionStart should synchronously install footer before editor");
	assert.deepEqual(git.schedules, [true], "enabled sessionStart should schedule an immediate git refresh through the adapter");
	assert.equal(harness.getLoadConfigCalls(), 0, "sessionStart should not call the async loadConfig adapter");
}

{
	const git = createGitHarness();
	const test = createContext();
	const harness = createRuntimeHarness({ loadConfigSyncConfig: disabledConfig(), git });
	const result = harness.runtime.events.sessionStart({}, test.ctx);

	assert.equal(isPromiseLike(result), false, "sessionStart should stay synchronous for disabled config");
	assert.deepEqual(test.surfaceCalls, ["setEditorComponent:clear", "setFooter:clear"], "disabled TUI sessionStart should synchronously restore editor and footer");
	assert.equal(git.created, 0, "disabled sessionStart should not create a git refresher");
	assert.equal(harness.getLoadConfigCalls(), 0, "disabled sessionStart should not call the async loadConfig adapter");
}

{
	const initialConfig = defaultConfig();
	const nextConfig = disabledConfig(initialConfig);
	const git = createGitHarness();
	const test = createContext();
	const harness = createRuntimeHarness({
		loadConfigSyncConfig: initialConfig,
		showPaneResults: [{ action: "save", config: nextConfig }, { action: "cancel" }],
		saveConfigError: new Error("blocked"),
		git,
	});

	harness.runtime.events.sessionStart({}, test.ctx);
	const surfaceBaseline = test.surfaceCalls.length;
	const scheduleBaseline = git.schedules.length;
	const renderBaseline = test.getRenderRequests();
	await harness.runtime.commands.openPane("", test.ctx);

	assert.equal(hasNotification(test.notifications, "pi-glance configuration save failed; keeping previous configuration", "error"), true, "save failure should notify the exact error copy");
	assert.equal(hasNotification(test.notifications, "pi-glance configuration saved", "info"), false, "save failure should not notify success");
	assert.deepEqual(test.surfaceCalls.slice(surfaceBaseline), [], "save failure should not reinstall or clear the input surface");
	assert.deepEqual(git.schedules.slice(scheduleBaseline), [], "save failure should not schedule git refreshes");
	assert.equal(test.getRenderRequests(), renderBaseline, "save failure should not request a render");

	await harness.runtime.commands.openPane("", test.ctx);
	assert.deepEqual(harness.showPaneInitials[1], initialConfig, "after failed save, the active config should still be the previous config");
}

{
	const initialConfig = defaultConfig();
	const nextConfig = nextEnabledConfig(initialConfig);
	const git = createGitHarness();
	const test = createContext();
	const harness = createRuntimeHarness({
		loadConfigSyncConfig: initialConfig,
		showPaneResults: [{ action: "save", config: nextConfig }, { action: "cancel" }],
		git,
	});

	harness.runtime.events.sessionStart({}, test.ctx);
	const surfaceBaseline = test.surfaceCalls.length;
	const renderBaseline = test.getRenderRequests();
	await harness.runtime.commands.openPane("", test.ctx);

	assert.deepEqual(harness.savedConfigs, [nextConfig], "save success should pass the next config to saveConfig");
	assert.equal(hasNotification(test.notifications, "pi-glance configuration saved", "info"), true, "save success should notify saved");
	assert.deepEqual(test.surfaceCalls.slice(surfaceBaseline), ["setFooter:install", "setEditorComponent:install"], "save success should reinstall the enabled TUI input surface");
	assert.ok(test.getRenderRequests() > renderBaseline, "save success should request a render after reinstalling the surface");
	assert.deepEqual(git.options?.getConfig(), nextConfig.git, "existing git refresher should read the updated active git config after save success");

	await harness.runtime.commands.openPane("", test.ctx);
	assert.deepEqual(harness.showPaneInitials[1], nextConfig, "after successful save, later pane opens should receive the next active config");
}

{
	const initialConfig = defaultConfig();
	const nextConfig = nextEnabledConfig(initialConfig);
	const git = createGitHarness();
	const test = createContext({ invokeFooterFactory: false });
	const harness = createRuntimeHarness({
		loadConfigSyncConfig: initialConfig,
		showPaneResults: [{ action: "save", config: nextConfig }],
		git,
	});

	harness.runtime.events.sessionStart({}, test.ctx);
	assert.equal(test.footerFactories.length, 1, "initial install should register one footer factory");
	let staleFooterRenders = 0;
	let currentFooterRenders = 0;
	invokeFooterFactory(test, 0, () => staleFooterRenders++);
	git.options?.onSnapshot("/repo", gitSnapshot("before-footer-reinstall"));
	assert.equal(staleFooterRenders, 1, "initial footer factory should own render before reinstall");

	await harness.runtime.commands.openPane("", test.ctx);
	assert.equal(test.footerFactories.length, 2, "enabled save should register a replacement footer factory");
	assert.equal(staleFooterRenders, 1, "enabled reinstall should clear the previous render callback before post-save render");

	invokeFooterFactory(test, 1, () => currentFooterRenders++);
	invokeFooterFactory(test, 0, () => staleFooterRenders++);
	git.options?.onSnapshot("/repo", gitSnapshot("after-footer-reinstall"));
	assert.equal(staleFooterRenders, 1, "stale footer factory should not regain render ownership after reinstall");
	assert.equal(currentFooterRenders, 1, "newest footer factory should remain the active render owner after stale factory invocation");
}

{
	const initialConfig = defaultConfig();
	const nextConfig = nextEnabledConfig(initialConfig);
	const git = createGitHarness();
	const test = createContext({ invokeFooterFactory: false });
	const harness = createRuntimeHarness({
		loadConfigSyncConfig: initialConfig,
		showPaneResults: [{ action: "save", config: nextConfig }],
		git,
	});

	harness.runtime.events.sessionStart({}, test.ctx);
	assert.equal(test.editorFactories.length, 1, "initial install should register one editor factory");
	let staleEditorRenders = 0;
	let currentEditorRenders = 0;
	invokeEditorFactory(test, 0, () => staleEditorRenders++);
	git.options?.onSnapshot("/repo", gitSnapshot("before-editor-reinstall"));
	assert.equal(staleEditorRenders, 1, "initial editor factory should own render before reinstall");

	await harness.runtime.commands.openPane("", test.ctx);
	assert.equal(test.editorFactories.length, 2, "enabled save should register a replacement editor factory");
	assert.equal(staleEditorRenders, 1, "enabled reinstall should clear the previous editor render callback before post-save render");

	invokeEditorFactory(test, 1, () => currentEditorRenders++);
	invokeEditorFactory(test, 0, () => staleEditorRenders++);
	git.options?.onSnapshot("/repo", gitSnapshot("after-editor-reinstall"));
	assert.equal(staleEditorRenders, 1, "stale editor factory should not regain render ownership after reinstall");
	assert.equal(currentEditorRenders, 1, "newest editor factory should remain the active render owner after stale factory invocation");
}

{
	const initialConfig = defaultConfig();
	const nextConfig = disabledConfig(initialConfig);
	const git = createGitHarness();
	const test = createContext({ invokeFooterFactory: false });
	const harness = createRuntimeHarness({
		loadConfigSyncConfig: initialConfig,
		showPaneResults: [{ action: "save", config: nextConfig }],
		git,
	});

	harness.runtime.events.sessionStart({}, test.ctx);
	let staleFooterRenders = 0;
	let staleEditorRenders = 0;
	invokeFooterFactory(test, 0, () => staleFooterRenders++);
	invokeEditorFactory(test, 0, () => staleEditorRenders++);
	git.options?.onSnapshot("/repo", gitSnapshot("before-disabled-clear"));
	assert.equal(staleEditorRenders, 1, "latest initial editor factory should own render before disabled clear");

	await harness.runtime.commands.openPane("", test.ctx);
	assert.equal(staleFooterRenders, 0, "disabled clear should not use older footer render callback during post-save render");
	assert.equal(staleEditorRenders, 1, "disabled clear should remove latest editor render callback before post-save render");

	invokeFooterFactory(test, 0, () => staleFooterRenders++);
	invokeEditorFactory(test, 0, () => staleEditorRenders++);
	git.options?.onSnapshot("/repo", gitSnapshot("after-disabled-clear"));
	assert.equal(staleFooterRenders, 0, "stale footer factory should not revive render ownership after disabled clear");
	assert.equal(staleEditorRenders, 1, "stale editor factory should not revive render ownership after disabled clear");
}

{
	const initialConfig = defaultConfig();
	const git = createGitHarness();
	const test = createContext({ invokeFooterFactory: false });
	const harness = createRuntimeHarness({ loadConfigSyncConfig: initialConfig, git });

	harness.runtime.events.sessionStart({}, test.ctx);
	let staleFooterRenders = 0;
	let staleEditorRenders = 0;
	invokeFooterFactory(test, 0, () => staleFooterRenders++);
	invokeEditorFactory(test, 0, () => staleEditorRenders++);
	git.options?.onSnapshot("/repo", gitSnapshot("before-shutdown"));
	assert.equal(staleEditorRenders, 1, "latest initial editor factory should own render before shutdown");

	await harness.runtime.events.sessionShutdown({}, test.ctx as ExtensionContext);
	invokeFooterFactory(test, 0, () => staleFooterRenders++);
	invokeEditorFactory(test, 0, () => staleEditorRenders++);
	git.options?.onSnapshot("/repo", gitSnapshot("after-shutdown"));
	assert.equal(staleFooterRenders, 0, "stale footer factory should not revive render ownership after shutdown");
	assert.equal(staleEditorRenders, 1, "stale editor factory should not revive render ownership after shutdown");
	assert.equal(git.disposeCount, 1, "shutdown should still dispose the runtime git refresher");
}

{
	const initialConfig = defaultConfig();
	const git = createGitHarness();
	const test = createContext({ cwd: "/repo" });
	const harness = createRuntimeHarness({ loadConfigSyncConfig: initialConfig, git });

	harness.runtime.events.sessionStart({}, test.ctx);
	assert.equal(git.created, 1, "enabled sessionStart should create one git refresher through the adapter");
	assert.deepEqual(git.schedules, [true], "enabled sessionStart should schedule an immediate git refresh");
	assert.equal(git.options?.getCwd(), "/repo", "git refresher getCwd should expose the current state workspace path");

	const renderBaseline = test.getRenderRequests();
	git.options?.onSnapshot("/other", gitSnapshot("other"));
	assert.equal(test.getRenderRequests(), renderBaseline, "git snapshots for a stale cwd should not request render");

	git.options?.onSnapshot("/repo", gitSnapshot("main"));
	assert.equal(test.getRenderRequests(), renderBaseline + 1, "matching git snapshots should update state and request render");

	await harness.runtime.events.sessionShutdown({}, test.ctx as ExtensionContext);
	assert.equal(git.disposeCount, 1, "sessionShutdown should dispose the runtime git refresher");
}

{
	const git = createGitHarness();
	const test = createContext({ mode: "rpc", hasUI: true });
	const harness = createRuntimeHarness({ loadConfigSyncConfig: defaultConfig(), git });

	harness.runtime.events.sessionStart({}, test.ctx);
	assert.deepEqual(test.surfaceCalls, [], "RPC mode should not install custom TUI footer/editor even though ctx.hasUI is true");
	assert.equal(git.created, 0, "RPC mode should not start the TUI-only git refresher/input surface");
	await harness.runtime.events.sessionShutdown({}, test.ctx as ExtensionContext);
	assert.deepEqual(test.surfaceCalls, [], "RPC shutdown should not clear custom TUI components that were never installed");
}

{
	for (const mode of ["json", "print"] as const) {
		const git = createGitHarness();
		const test = createContext({ mode, hasUI: false });
		const harness = createRuntimeHarness({ loadConfigSyncConfig: defaultConfig(), git });

		harness.runtime.events.sessionStart({}, test.ctx);
		assert.deepEqual(test.surfaceCalls, [], `${mode} mode should not install custom TUI footer/editor`);
		assert.equal(git.created, 0, `${mode} mode should not start the TUI-only git refresher/input surface`);
		await harness.runtime.events.sessionShutdown({}, test.ctx as ExtensionContext);
		assert.deepEqual(test.surfaceCalls, [], `${mode} shutdown should not clear custom TUI components that were never installed`);
	}
}

{
	const test = createContext({ mode: "rpc", hasUI: true });
	const harness = createRuntimeHarness({ loadConfigSyncConfig: defaultConfig(), showPaneResults: [{ action: "cancel" }] });

	await harness.runtime.commands.openPane("", test.ctx);
	assert.deepEqual(harness.showPaneInitials, [], "non-TUI /glance should not invoke the custom pane adapter");
	assert.equal(hasNotification(test.notifications, "pi-glance configuration pane requires TUI mode", "error"), true, "non-TUI /glance should notify that the pane requires TUI mode");
}

{
	const test = createContext({ availableProviders: ["openai", "anthropic", "openai"] });
	const harness = createRuntimeHarness({ loadConfigSyncConfig: defaultConfig(), showPaneResults: [{ action: "cancel" }] });

	harness.runtime.events.sessionStart({}, test.ctx);
	await harness.runtime.commands.openPane("", test.ctx);
	const previewState = harness.showPaneInitials.length;
	assert.equal(previewState, 1, "TUI /glance should still open after provider-count snapshot setup");
}

console.log("✓ runtime seam checks passed");
