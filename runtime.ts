import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GlanceEditor } from "./editor.js";
import { GlanceFooterBridge } from "./footer-bridge.js";
import { GitRefresher } from "./git.js";
import { stateInputsFromContext } from "./runtime-snapshot.js";
import { clearContextUsage, createInitialState, refreshContextUsage, refreshModel, refreshWorkspace, setGitSnapshot, setUsageTotals } from "./state.js";
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

export interface GlanceRuntimeAdapters {
	getThinkingLevel(): string;
	loadConfigSync(): GlanceConfig;
	loadConfig(): Promise<GlanceConfig>;
	saveConfig(config: GlanceConfig): Promise<void>;
	showPane(initial: GlanceConfig, ctx: ExtensionCommandContext, previewState?: GlanceState): Promise<GlancePaneResult>;
	createGitRefresher?: (options: CreateGitRefresherOptions) => RuntimeGitRefresher;
}

interface MessageEndLikeEvent {
	message: {
		role?: string;
	};
}

export interface GlanceRuntime {
	commands: {
		openPane(args: string, ctx: ExtensionCommandContext): Promise<void>;
	};
	events: {
		sessionStart(event: unknown, ctx: ExtensionContext): void;
		sessionShutdown(event: unknown, ctx: ExtensionContext): Promise<void>;
		modelSelect(event: unknown, ctx: ExtensionContext): Promise<void>;
		thinkingLevelSelect(event: unknown, ctx: ExtensionContext): Promise<void>;
		turnStart(event: unknown, ctx: ExtensionContext): Promise<void>;
		toolExecutionEnd(event: unknown, ctx: ExtensionContext): Promise<void>;
		sessionTree(event: unknown, ctx: ExtensionContext): Promise<void>;
		sessionCompact(event: unknown, ctx: ExtensionContext): Promise<void>;
		messageEnd(event: MessageEndLikeEvent, ctx: ExtensionContext): Promise<void>;
		turnEnd(event: unknown, ctx: ExtensionContext): Promise<void>;
		agentEnd(event: unknown, ctx: ExtensionContext): Promise<void>;
	};
}

function createDefaultGitRefresher(options: CreateGitRefresherOptions): RuntimeGitRefresher {
	return new GitRefresher(options.getConfig, options.getCwd, options.onSnapshot);
}

export function createGlanceRuntime(adapters: GlanceRuntimeAdapters): GlanceRuntime {
	let config: GlanceConfig | undefined;
	let state: GlanceState | undefined;
	let footerBridge: GlanceFooterBridge | undefined;
	let gitRefresher: RuntimeGitRefresher | undefined;
	let requestRender: (() => void) | undefined;

	async function ensureConfig(): Promise<GlanceConfig> {
		config ??= await adapters.loadConfig();
		return config;
	}

	function getConfig(): GlanceConfig {
		if (!config) throw new Error("pi-glance config not loaded");
		return config;
	}

	function ensureState(ctx: ExtensionContext): GlanceState {
		if (!state) {
			state = createInitialState(stateInputsFromContext(ctx, adapters.getThinkingLevel()), getConfig());
		}
		return state;
	}

	function renderNow(): void {
		footerBridge?.invalidate();
		requestRender?.();
	}

	function ensureGitRefresher(): RuntimeGitRefresher {
		gitRefresher ??= (adapters.createGitRefresher ?? createDefaultGitRefresher)({
			getConfig: () => getConfig().git,
			getCwd: () => state?.workspace.path,
			onSnapshot: (cwd, snapshot) => {
				if (state && setGitSnapshot(state, cwd, snapshot)) renderNow();
			},
		});
		return gitRefresher;
	}

	function scheduleGitRefresh(immediate = false): void {
		gitRefresher?.schedule(immediate);
	}

	function refreshReliableSnapshot(ctx: ExtensionContext, options: { model?: boolean; git?: boolean } = {}): void {
		if (!state) return;
		const inputs = stateInputsFromContext(ctx, adapters.getThinkingLevel());
		const workspaceChanged = refreshWorkspace(state, inputs);
		if (options.model) refreshModel(state, inputs, getConfig());
		setUsageTotals(state, inputs.usage);
		refreshContextUsage(state, inputs);
		if (options.git || workspaceChanged) scheduleGitRefresh(options.git || workspaceChanged);
	}

	function refreshThinkingLevel(ctx: ExtensionContext): void {
		if (!state) return;
		const inputs = stateInputsFromContext(ctx, adapters.getThinkingLevel());
		refreshModel(state, inputs, getConfig());
	}

	function clearBridge(): void {
		footerBridge?.dispose();
		footerBridge = undefined;
	}

	function clearGitRefresher(): void {
		gitRefresher?.dispose();
		gitRefresher = undefined;
	}

	function clearUI(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		clearBridge();
		clearGitRefresher();
		ctx.ui.setEditorComponent(undefined);
		ctx.ui.setFooter(undefined);
		requestRender = undefined;
	}

	function installInputSurface(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ensureState(ctx);
		const activeConfig = getConfig();
		if (!activeConfig.enabled) {
			clearUI(ctx);
			return;
		}

		ensureGitRefresher().schedule(true);
		clearBridge();
		ctx.ui.setFooter((tui, _theme, footerData) => {
			requestRender = () => tui.requestRender();
			footerBridge = new GlanceFooterBridge(() => state ?? ensureState(ctx), footerData);
			return footerBridge;
		});

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			requestRender = () => tui.requestRender();
			return new GlanceEditor(
				tui,
				theme,
				keybindings,
				() => state ?? ensureState(ctx),
				() => getConfig(),
				() => {
					refreshThinkingLevel(ctx);
					renderNow();
				},
			);
		});
	}

	return {
		commands: {
			openPane: async (_args, ctx) => {
				const current = await ensureConfig();
				ensureState(ctx);
				const result = await adapters.showPane(current, ctx, state);
				if (result.action === "cancel") {
					ctx.ui.notify("pi-glance configuration cancelled", "info");
					return;
				}

				const nextConfig = result.config;
				try {
					await adapters.saveConfig(nextConfig);
				} catch {
					ctx.ui.notify("pi-glance configuration save failed; keeping previous configuration", "error");
					return;
				}

				config = nextConfig;
				if (state) {
					refreshReliableSnapshot(ctx, { model: true, git: true });
				}
				installInputSurface(ctx);
				renderNow();
				ctx.ui.notify("pi-glance configuration saved", "info");
			},
		},
		events: {
			sessionStart: (_event, ctx) => {
				config = adapters.loadConfigSync();
				state = createInitialState(stateInputsFromContext(ctx, adapters.getThinkingLevel()), config);
				installInputSurface(ctx);
			},
			sessionShutdown: async (_event, ctx) => {
				clearUI(ctx);
			},
			modelSelect: async (_event, ctx) => {
				await ensureConfig();
				ensureState(ctx);
				refreshReliableSnapshot(ctx, { model: true, git: true });
				renderNow();
			},
			thinkingLevelSelect: async (_event, ctx) => {
				await ensureConfig();
				ensureState(ctx);
				refreshThinkingLevel(ctx);
				renderNow();
			},
			turnStart: async (_event, ctx) => {
				await ensureConfig();
				ensureState(ctx);
				refreshReliableSnapshot(ctx, { model: true });
				renderNow();
			},
			toolExecutionEnd: async (_event, ctx) => {
				await ensureConfig();
				ensureState(ctx);
				refreshReliableSnapshot(ctx, { git: true });
				renderNow();
			},
			sessionTree: async (_event, ctx) => {
				await ensureConfig();
				ensureState(ctx);
				refreshReliableSnapshot(ctx, { model: true, git: true });
				renderNow();
			},
			sessionCompact: async (_event, ctx) => {
				await ensureConfig();
				ensureState(ctx);
				const inputs = stateInputsFromContext(ctx, adapters.getThinkingLevel());
				refreshWorkspace(state!, inputs);
				refreshModel(state!, inputs, getConfig());
				setUsageTotals(state!, inputs.usage);
				clearContextUsage(state!, inputs);
				scheduleGitRefresh(true);
				renderNow();
			},
			messageEnd: async (event, ctx) => {
				await ensureConfig();
				ensureState(ctx);
				if (event.message.role === "assistant") {
					refreshReliableSnapshot(ctx);
					renderNow();
				}
			},
			turnEnd: async (_event, ctx) => {
				await ensureConfig();
				ensureState(ctx);
				refreshReliableSnapshot(ctx);
				renderNow();
			},
			agentEnd: async (_event, ctx) => {
				await ensureConfig();
				ensureState(ctx);
				refreshReliableSnapshot(ctx);
				renderNow();
			},
		},
	};
}
