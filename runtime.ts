import { performance } from "node:perf_hooks";
import type {
	AgentEndEvent,
	AgentSettledEvent,
	AgentStartEvent,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionEvent,
	MessageEndEvent,
	MessageUpdateEvent,
	SessionCompactEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionTreeEvent,
	ToolExecutionEndEvent,
	TurnEndEvent,
	TurnStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { ConfigLoadResult } from "./config.js";
import { GlanceEditor } from "./editor.js";
import { GlanceFooter } from "./footer.js";
import { GitRefresher } from "./git.js";
import { RuntimeRefreshSession } from "./runtime-refresh-session.js";
import type { GlanceRenderStyleContext } from "./theme-adapter.js";
import { readPiAmbientTone } from "./theme-tone.js";
import type { GitSnapshot, GlanceConfig, GlanceState } from "./types.js";

export type GlancePaneResult = { action: "save"; config: GlanceConfig } | { action: "cancel" };

export interface RuntimeGitRefresher {
	schedule(immediate?: boolean): void;
	dispose(): void;
}

export interface CreateGitRefresherOptions {
	getConfig(): GlanceConfig["git"];
	getCwd(): string | undefined;
	onSnapshot(cwd: string, snapshot: GitSnapshot): void;
}

export interface RuntimeShowPaneOptions {
	readonly renderStyleContext?: GlanceRenderStyleContext;
}

export interface GlanceRuntimeAdapters {
	getThinkingLevel(): string;
	loadConfigSync(): ConfigLoadResult;
	loadConfig(): Promise<ConfigLoadResult>;
	saveConfig(config: GlanceConfig): Promise<void>;
	showPane(initial: GlanceConfig, ctx: ExtensionCommandContext, previewState?: GlanceState, options?: RuntimeShowPaneOptions): Promise<GlancePaneResult>;
	createGitRefresher?: (options: CreateGitRefresherOptions) => RuntimeGitRefresher;
	nowMs?: () => number;
}

type RuntimeModelSelectEvent = Extract<ExtensionEvent, { type: "model_select" }>;
type RuntimeThinkingLevelSelectEvent = Extract<ExtensionEvent, { type: "thinking_level_select" }>;
type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

export interface GlanceRuntime {
	commands: {
		openPane(args: string, ctx: ExtensionCommandContext): Promise<void>;
	};
	events: {
		sessionStart(event: SessionStartEvent, ctx: ExtensionContext): void;
		sessionShutdown(event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void>;
		modelSelect(event: RuntimeModelSelectEvent, ctx: ExtensionContext): Promise<void>;
		thinkingLevelSelect(event: RuntimeThinkingLevelSelectEvent, ctx: ExtensionContext): Promise<void>;
		turnStart(event: TurnStartEvent, ctx: ExtensionContext): Promise<void>;
		toolExecutionEnd(event: ToolExecutionEndEvent, ctx: ExtensionContext): Promise<void>;
		sessionTree(event: SessionTreeEvent, ctx: ExtensionContext): Promise<void>;
		sessionCompact(event: SessionCompactEvent, ctx: ExtensionContext): Promise<void>;
		messageUpdate(event: MessageUpdateEvent, ctx: ExtensionContext): void;
		messageEnd(event: MessageEndEvent, ctx: ExtensionContext): Promise<void>;
		turnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<void>;
		agentStart(event: AgentStartEvent, ctx: ExtensionContext): void;
		agentEnd(event: AgentEndEvent, ctx: ExtensionContext): Promise<void>;
		agentSettled(event: AgentSettledEvent, ctx: ExtensionContext): void;
	};
}

function createDefaultGitRefresher(options: CreateGitRefresherOptions): RuntimeGitRefresher {
	return new GitRefresher(options.getConfig, options.getCwd, options.onSnapshot);
}

function isTuiMode(ctx: ExtensionContext): boolean {
	return ctx.mode === "tui";
}

function runtimeRenderStyleContext(ctx: ExtensionContext): GlanceRenderStyleContext {
	return { getAmbientTone: () => readPiAmbientTone(ctx.ui) };
}

export function createGlanceRuntime(adapters: GlanceRuntimeAdapters): GlanceRuntime {
	let config: GlanceConfig | undefined;
	let configWritable = true;
	let configDiagnostic: string | undefined;
	let configDiagnosticStatus: ConfigLoadResult["status"] | undefined;
	let configDiagnosticNotified = false;
	let footer: GlanceFooter | undefined;
	let ownedEditorFactory: EditorFactory | undefined;
	let previousEditorFactory: EditorFactory | undefined;
	let gitRefresher: RuntimeGitRefresher | undefined;
	let requestRender: (() => void) | undefined;
	let uiGeneration = 0;
	const nowMs = adapters.nowMs ?? (() => performance.now());

	function acceptConfigLoad(result: ConfigLoadResult): GlanceConfig {
		config = result.config;
		configWritable = result.writable;
		configDiagnostic = result.diagnostic;
		configDiagnosticStatus = result.status;
		configDiagnosticNotified = false;
		return result.config;
	}

	function notifyConfigDiagnostic(ctx: ExtensionContext): void {
		if (!ctx.hasUI || !configDiagnostic || configDiagnosticNotified) return;
		configDiagnosticNotified = true;
		ctx.ui.notify(configDiagnostic, configDiagnosticStatus === "future" ? "warning" : "error");
	}

	async function ensureConfig(): Promise<GlanceConfig> {
		if (!config) return acceptConfigLoad(await adapters.loadConfig());
		return config;
	}

	function getConfig(): GlanceConfig {
		if (!config) throw new Error("pi-glance config not loaded");
		return config;
	}

	function shouldRunGitRefresher(activeConfig: GlanceConfig = getConfig()): boolean {
		return activeConfig.enabled && activeConfig.segments.some((segment) => segment.id === "git" && segment.enabled);
	}

	function renderNow(): void {
		footer?.invalidate();
		requestRender?.();
	}

	function isCurrentUiGeneration(generation: number): boolean {
		return generation === uiGeneration;
	}

	function setUiRequestRender(generation: number, callback: () => void): void {
		if (!isCurrentUiGeneration(generation)) return;
		requestRender = () => {
			if (isCurrentUiGeneration(generation)) callback();
		};
	}

	const refreshSession = new RuntimeRefreshSession({
		getConfig,
		ensureConfig,
		getThinkingLevel: () => adapters.getThinkingLevel(),
		nowMs: () => nowMs(),
		requestRender: renderNow,
		scheduleGitRefresh,
	});

	function ensureGitRefresher(): RuntimeGitRefresher {
		gitRefresher ??= (adapters.createGitRefresher ?? createDefaultGitRefresher)({
			getConfig: () => getConfig().git,
			getCwd: () => refreshSession.getState()?.workspace.path,
			onSnapshot: (cwd, snapshot) => {
				refreshSession.applyGitSnapshot(cwd, snapshot);
			},
		});
		return gitRefresher;
	}

	function scheduleGitRefresh(immediate = false): void {
		if (!shouldRunGitRefresher()) return;
		gitRefresher?.schedule(immediate);
	}

	function clearFooter(): void {
		footer?.dispose();
		footer = undefined;
	}

	function invalidateUiOwnership(): number {
		uiGeneration++;
		requestRender = undefined;
		clearFooter();
		return uiGeneration;
	}

	function clearGitRefresher(): void {
		gitRefresher?.dispose();
		gitRefresher = undefined;
	}

	function reconcileGitRefresher(immediate = false): void {
		if (!shouldRunGitRefresher()) {
			clearGitRefresher();
			return;
		}
		const refresher = ensureGitRefresher();
		if (immediate) refresher.schedule(true);
	}

	function restoreOwnedEditor(ctx: ExtensionContext): void {
		const ownedFactory = ownedEditorFactory;
		if (!ownedFactory) return;
		const restoreFactory = previousEditorFactory;
		ownedEditorFactory = undefined;
		previousEditorFactory = undefined;
		if (ctx.ui.getEditorComponent() === ownedFactory) ctx.ui.setEditorComponent(restoreFactory);
	}

	function clearUI(ctx: ExtensionContext): void {
		if (!isTuiMode(ctx)) return;
		invalidateUiOwnership();
		clearGitRefresher();
		restoreOwnedEditor(ctx);
		ctx.ui.setFooter(undefined);
	}

	function installInputSurface(ctx: ExtensionContext): void {
		if (!isTuiMode(ctx)) return;
		refreshSession.ensureState(ctx);
		const activeConfig = getConfig();
		if (!activeConfig.enabled) {
			clearUI(ctx);
			return;
		}

		const renderStyleContext = runtimeRenderStyleContext(ctx);
		const generation = invalidateUiOwnership();

		reconcileGitRefresher(true);
		ctx.ui.setFooter((tui) => {
			const nextFooter = new GlanceFooter();
			if (isCurrentUiGeneration(generation)) {
				setUiRequestRender(generation, () => tui.requestRender());
				footer = nextFooter;
			}
			return nextFooter;
		});

		const currentEditorFactory = ctx.ui.getEditorComponent();
		if (currentEditorFactory !== ownedEditorFactory) previousEditorFactory = currentEditorFactory;
		const nextEditorFactory: EditorFactory = (tui, theme, keybindings) => {
			setUiRequestRender(generation, () => tui.requestRender());
			return new GlanceEditor(
				tui,
				theme,
				keybindings,
				() => refreshSession.getState() ?? refreshSession.ensureState(ctx),
				() => getConfig(),
				() => {
					void refreshSession.editorThinkingCycle(ctx);
				},
				{ renderStyleContext },
			);
		};
		ownedEditorFactory = nextEditorFactory;
		ctx.ui.setEditorComponent(nextEditorFactory);
	}

	return {
		commands: {
			openPane: async (_args, ctx) => {
				if (!isTuiMode(ctx)) {
					ctx.ui.notify("pi-glance configuration pane requires TUI mode", "error");
					return;
				}
				const current = await ensureConfig();
				notifyConfigDiagnostic(ctx);
				refreshSession.ensureState(ctx);
				const renderStyleContext = runtimeRenderStyleContext(ctx);
				const result = await adapters.showPane(current, ctx, refreshSession.getState(), { renderStyleContext });
				if (result.action === "cancel") {
					ctx.ui.notify("pi-glance configuration cancelled", "info");
					return;
				}

				const previousConfig = current;
				const nextConfig = result.config;
				if (!configWritable) {
					ctx.ui.notify("pi-glance configuration save blocked to protect the existing file; fix or remove it, then /reload", "error");
					return;
				}
				try {
					await adapters.saveConfig(nextConfig);
				} catch {
					ctx.ui.notify("pi-glance configuration save failed; keeping previous configuration", "error");
					return;
				}

				config = nextConfig;
				configWritable = true;
				configDiagnostic = undefined;
				configDiagnosticStatus = "loaded";
				configDiagnosticNotified = false;
				if (previousConfig.enabled && nextConfig.enabled) reconcileGitRefresher();
				await refreshSession.configSaved(
					ctx,
					previousConfig.enabled === nextConfig.enabled ? undefined : () => installInputSurface(ctx),
				);
				ctx.ui.notify("pi-glance configuration saved", "info");
			},
		},
		events: {
			sessionStart: (_event, ctx) => {
				acceptConfigLoad(adapters.loadConfigSync());
				notifyConfigDiagnostic(ctx);
				refreshSession.sessionStart(ctx);
				installInputSurface(ctx);
			},
			sessionShutdown: async (_event, ctx) => {
				refreshSession.sessionShutdown();
				clearUI(ctx);
			},
			modelSelect: async (_event, ctx) => {
				await refreshSession.modelSelect(ctx);
			},
			thinkingLevelSelect: async (_event, ctx) => {
				await refreshSession.thinkingLevelSelect(ctx);
			},
			turnStart: async (_event, ctx) => {
				await refreshSession.turnStart(ctx);
			},
			toolExecutionEnd: async (_event, ctx) => {
				await refreshSession.toolExecutionEnd(ctx);
			},
			sessionTree: async (_event, ctx) => {
				await refreshSession.sessionTree(ctx);
			},
			sessionCompact: async (event, ctx) => {
				await refreshSession.sessionCompact(event, ctx);
			},
			messageUpdate: (event, _ctx) => {
				refreshSession.messageUpdate(event);
			},
			messageEnd: async (event, ctx) => {
				await refreshSession.messageEnd(event, ctx);
			},
			turnEnd: async (event, ctx) => {
				await refreshSession.turnEnd(event, ctx);
			},
			agentStart: (_event, _ctx) => {
				refreshSession.agentStart();
			},
			agentEnd: async (event, ctx) => {
				await refreshSession.agentEnd(event, ctx);
			},
			agentSettled: (_event, _ctx) => {
				refreshSession.agentSettled();
			},
		},
	};
}
