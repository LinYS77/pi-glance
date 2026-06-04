import { strict as assert } from "node:assert";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../config.js";
import { createGlanceRuntime, type CreateGitRefresherOptions, type GlancePaneResult, type GlanceRuntimeAdapters, type RuntimeGitRefresher } from "../runtime.js";
import type { GitSnapshot, GlanceConfig } from "../types.js";

interface Notification {
	message: string;
	type: "info" | "warning" | "error" | undefined;
}

interface TestContext {
	ctx: ExtensionCommandContext;
	surfaceCalls: string[];
	notifications: Notification[];
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

function createContext(options: { cwd?: string; invokeFooterFactory?: boolean } = {}): TestContext {
	const surfaceCalls: string[] = [];
	const notifications: Notification[] = [];
	let renderRequests = 0;
	let cwd = options.cwd ?? "/repo";
	const invokeFooterFactory = options.invokeFooterFactory ?? true;
	const fakeTui = { requestRender: () => renderRequests++ };
	const fakeTheme = {};
	const fakeFooterData = { getAvailableProviderCount: () => 1 };

	const ctx = {
		hasUI: true,
		get cwd() {
			return cwd;
		},
		model: { id: "test-model", provider: "test-provider", contextWindow: 200_000 },
		sessionManager: {
			getCwd: () => cwd,
			getEntries: () => [],
			getBranch: () => [],
		},
		ui: {
			notify: (message: string, type?: "info" | "warning" | "error") => notifications.push({ message, type }),
			setFooter: (factory: unknown) => {
				surfaceCalls.push(factory ? "setFooter:install" : "setFooter:clear");
				if (factory && invokeFooterFactory) {
					(factory as (tui: unknown, theme: unknown, footerData: unknown) => unknown)(fakeTui, fakeTheme, fakeFooterData);
				}
			},
			setEditorComponent: (factory: unknown) => surfaceCalls.push(factory ? "setEditorComponent:install" : "setEditorComponent:clear"),
		},
		getContextUsage: () => ({ tokens: 42, contextWindow: 200_000, percent: 0.021 }),
	} as unknown as ExtensionCommandContext;

	return {
		ctx,
		surfaceCalls,
		notifications,
		getRenderRequests: () => renderRequests,
		setCwd: (nextCwd: string) => {
			cwd = nextCwd;
		},
	};
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
	assert.deepEqual(test.surfaceCalls, ["setFooter:install", "setEditorComponent:install"], "enabled sessionStart should synchronously install footer before editor");
	assert.deepEqual(git.schedules, [true], "enabled sessionStart should schedule an immediate git refresh through the adapter");
	assert.equal(harness.getLoadConfigCalls(), 0, "sessionStart should not call the async loadConfig adapter");
}

{
	const git = createGitHarness();
	const test = createContext();
	const harness = createRuntimeHarness({ loadConfigSyncConfig: disabledConfig(), git });
	const result = harness.runtime.events.sessionStart({}, test.ctx);

	assert.equal(isPromiseLike(result), false, "sessionStart should stay synchronous for disabled config");
	assert.deepEqual(test.surfaceCalls, ["setEditorComponent:clear", "setFooter:clear"], "disabled sessionStart should synchronously restore editor and footer");
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
	assert.deepEqual(test.surfaceCalls.slice(surfaceBaseline), ["setFooter:install", "setEditorComponent:install"], "save success should reinstall the enabled input surface");
	assert.ok(test.getRenderRequests() > renderBaseline, "save success should request a render after reinstalling the surface");
	assert.deepEqual(git.options?.getConfig(), nextConfig.git, "existing git refresher should read the updated active git config after save success");

	await harness.runtime.commands.openPane("", test.ctx);
	assert.deepEqual(harness.showPaneInitials[1], nextConfig, "after successful save, later pane opens should receive the next active config");
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

console.log("✓ runtime seam checks passed");
