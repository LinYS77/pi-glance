import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GlanceEditor } from "./editor.js";
import { GlanceFooter } from "./footer.js";
import { GitRefresher } from "./git.js";
import { readPiUiTheme, resolveRuntimeRenderStyleContext } from "./render-style-context.js";
import { applyRuntimeRefreshPlan } from "./runtime-plan-executor.js";
import { runtimePlanFor, type RuntimeEventFacts, type RuntimeEventKind } from "./runtime-policy.js";
import type { GlanceRenderStyleContext } from "./theme-adapter.js";
import { assistantMessageHasKnownContextUsage, stateInputsFromContext, usageTotalsFromAssistantMessage, type StateInputs, type StateMessageInputs } from "./runtime-snapshot.js";
import { addUsageTotals, clearCurrentRunThroughput, createInitialState, setCurrentRunThroughput, setGitSnapshot, setLastTurnThroughput } from "./state.js";
import { ThroughputRunTracker, type ThroughputRunStateIntent } from "./throughput-run-tracker.js";
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
	loadConfigSync(): GlanceConfig;
	loadConfig(): Promise<GlanceConfig>;
	saveConfig(config: GlanceConfig): Promise<void>;
	showPane(initial: GlanceConfig, ctx: ExtensionCommandContext, previewState?: GlanceState, options?: RuntimeShowPaneOptions): Promise<GlancePaneResult>;
	createGitRefresher?: (options: CreateGitRefresherOptions) => RuntimeGitRefresher;
	nowMs?: () => number;
}

interface MessageEndLikeEvent {
	message: StateMessageInputs & {
		responseId?: unknown;
	};
}

interface TurnEndLikeEvent {
	turnIndex?: unknown;
	message?: unknown;
}

interface AgentEndLikeEvent {
	messages?: unknown;
}

interface RuntimeModeContext {
	mode?: string;
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
		turnEnd(event: TurnEndLikeEvent, ctx: ExtensionContext): Promise<void>;
		agentStart(event: unknown, ctx: ExtensionContext): void;
		agentEnd(event: AgentEndLikeEvent, ctx: ExtensionContext): Promise<void>;
	};
}

function createDefaultGitRefresher(options: CreateGitRefresherOptions): RuntimeGitRefresher {
	return new GitRefresher(options.getConfig, options.getCwd, options.onSnapshot);
}

function isTuiMode(ctx: ExtensionContext): boolean {
	return (ctx as ExtensionContext & RuntimeModeContext).mode === "tui";
}

function applyThroughputIntent(state: GlanceState, intent: ThroughputRunStateIntent): boolean {
	switch (intent.kind) {
		case "none":
			return false;
		case "set-current-run":
			return setCurrentRunThroughput(state, intent.currentRun);
		case "clear-current-run":
			return clearCurrentRunThroughput(state);
		case "set-last-turn-and-clear-current-run": {
			const lastTurnChanged = setLastTurnThroughput(state, intent.lastTurn);
			const currentRunChanged = clearCurrentRunThroughput(state);
			return lastTurnChanged || currentRunChanged;
		}
	}
}

export function createGlanceRuntime(adapters: GlanceRuntimeAdapters): GlanceRuntime {
	let config: GlanceConfig | undefined;
	let state: GlanceState | undefined;
	let footer: GlanceFooter | undefined;
	let gitRefresher: RuntimeGitRefresher | undefined;
	let requestRender: (() => void) | undefined;
	let uiGeneration = 0;
	let unknownContextAfterLatestCompaction = false;
	let appliedAssistantMessageObjects = new WeakSet<object>();
	let appliedAssistantMessageResponseIds = new Set<string>();
	const throughputTracker = new ThroughputRunTracker();
	const nowMs = adapters.nowMs ?? Date.now;

	async function ensureConfig(): Promise<GlanceConfig> {
		config ??= await adapters.loadConfig();
		return config;
	}

	function getConfig(): GlanceConfig {
		if (!config) throw new Error("pi-glance config not loaded");
		return config;
	}

	function setUnknownContextAfterLatestCompaction(value: boolean): void {
		unknownContextAfterLatestCompaction = value;
	}

	function clearContextUnknownAfterKnownAssistantUsage(message: StateMessageInputs): void {
		if (unknownContextAfterLatestCompaction && assistantMessageHasKnownContextUsage(message)) {
			unknownContextAfterLatestCompaction = false;
		}
	}

	function readStateInputs(ctx: ExtensionContext): StateInputs {
		const inputs = stateInputsFromContext(ctx, adapters.getThinkingLevel());
		setUnknownContextAfterLatestCompaction(inputs.unknownContextAfterLatestCompaction);
		return inputs;
	}

	function ensureState(ctx: ExtensionContext): GlanceState {
		if (!state) {
			state = createInitialState(readStateInputs(ctx), getConfig());
		}
		return state;
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

	function resetAssistantMessageDedupe(): void {
		appliedAssistantMessageObjects = new WeakSet<object>();
		appliedAssistantMessageResponseIds = new Set<string>();
	}

	function usageTotalsAreZero(delta: ReturnType<typeof usageTotalsFromAssistantMessage>): boolean {
		return delta.input === 0 && delta.output === 0 && delta.cacheRead === 0 && delta.cacheWrite === 0 && delta.cost === 0;
	}

	function applyAssistantMessageUsageDelta(message: StateMessageInputs & { responseId?: unknown }): boolean {
		if (!state || message.role !== "assistant") return false;
		const delta = usageTotalsFromAssistantMessage(message);
		if (usageTotalsAreZero(delta)) return false;
		if (typeof message.responseId === "string" && message.responseId) {
			if (appliedAssistantMessageResponseIds.has(message.responseId)) return false;
			appliedAssistantMessageResponseIds.add(message.responseId);
		} else if (typeof message === "object" && message !== null) {
			if (appliedAssistantMessageObjects.has(message)) return false;
			appliedAssistantMessageObjects.add(message);
		}
		return addUsageTotals(state, delta);
	}

	async function executeRuntimePlan(kind: RuntimeEventKind, ctx: ExtensionContext, facts?: RuntimeEventFacts, beforeRender?: () => void): Promise<void> {
		const plan = runtimePlanFor(kind, facts);
		if (plan.ensureConfig) await ensureConfig();
		if (plan.ensureState) ensureState(ctx);
		if (state) {
			applyRuntimeRefreshPlan({
				state,
				config: getConfig(),
				ctx,
				plan,
				getThinkingLevel: () => adapters.getThinkingLevel(),
				unknownContextAfterLatestCompaction,
				setUnknownContextAfterLatestCompaction,
				scheduleGitRefresh,
			});
		}
		beforeRender?.();
		if (plan.render) renderNow();
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

	function clearUI(ctx: ExtensionContext): void {
		if (!isTuiMode(ctx)) return;
		invalidateUiOwnership();
		clearGitRefresher();
		ctx.ui.setEditorComponent(undefined);
		ctx.ui.setFooter(undefined);
	}

	function installInputSurface(ctx: ExtensionContext): void {
		if (!isTuiMode(ctx)) return;
		ensureState(ctx);
		const activeConfig = getConfig();
		if (!activeConfig.enabled) {
			clearUI(ctx);
			return;
		}

		const renderStyleContext = resolveRuntimeRenderStyleContext(activeConfig, { piTheme: readPiUiTheme(ctx.ui) });
		const generation = invalidateUiOwnership();

		ensureGitRefresher().schedule(true);
		ctx.ui.setFooter((tui) => {
			const nextFooter = new GlanceFooter();
			if (isCurrentUiGeneration(generation)) {
				setUiRequestRender(generation, () => tui.requestRender());
				footer = nextFooter;
			}
			return nextFooter;
		});

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			setUiRequestRender(generation, () => tui.requestRender());
			return new GlanceEditor(
				tui,
				theme,
				keybindings,
				() => state ?? ensureState(ctx),
				() => getConfig(),
				() => {
					void executeRuntimePlan("editor_thinking_cycle", ctx);
				},
				renderStyleContext ? { renderStyleContext } : undefined,
			);
		});
	}

	return {
		commands: {
			openPane: async (_args, ctx) => {
				if (!isTuiMode(ctx)) {
					ctx.ui.notify("pi-glance configuration pane requires TUI mode", "error");
					return;
				}
				const current = await ensureConfig();
				ensureState(ctx);
				const renderStyleContext = resolveRuntimeRenderStyleContext(current, { piTheme: readPiUiTheme(ctx.ui) });
				const result = await adapters.showPane(current, ctx, state, renderStyleContext ? { renderStyleContext } : undefined);
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
				await executeRuntimePlan("config_save_success", ctx, undefined, () => installInputSurface(ctx));
				ctx.ui.notify("pi-glance configuration saved", "info");
			},
		},
		events: {
			sessionStart: (_event, ctx) => {
				throughputTracker.reset();
				resetAssistantMessageDedupe();
				config = adapters.loadConfigSync();
				state = createInitialState(readStateInputs(ctx), config);
				installInputSurface(ctx);
			},
			sessionShutdown: async (_event, ctx) => {
				throughputTracker.reset();
				resetAssistantMessageDedupe();
				clearUI(ctx);
			},
			modelSelect: async (_event, ctx) => {
				await executeRuntimePlan("model_select", ctx);
			},
			thinkingLevelSelect: async (_event, ctx) => {
				await executeRuntimePlan("thinking_level_select", ctx);
			},
			turnStart: async (_event, ctx) => {
				await executeRuntimePlan("turn_start", ctx);
			},
			toolExecutionEnd: async (_event, ctx) => {
				await executeRuntimePlan("tool_execution_end", ctx);
			},
			sessionTree: async (_event, ctx) => {
				await executeRuntimePlan("session_tree", ctx);
			},
			sessionCompact: async (_event, ctx) => {
				await executeRuntimePlan("session_compact", ctx);
			},
			messageEnd: async (event, ctx) => {
				if (event.message.role === "assistant") clearContextUnknownAfterKnownAssistantUsage(event.message);
				await executeRuntimePlan("message_end", ctx, { messageRole: event.message.role }, () => {
					applyAssistantMessageUsageDelta(event.message);
				});
			},
			turnEnd: async (event, ctx) => {
				await executeRuntimePlan("turn_end", ctx, undefined, () => {
					if (!state) return;
					applyThroughputIntent(state, throughputTracker.checkpoint(event.turnIndex, event.message, nowMs));
				});
			},
			agentStart: (_event, _ctx) => {
				const intent = throughputTracker.start(nowMs());
				if (state && applyThroughputIntent(state, intent)) renderNow();
			},
			agentEnd: async (event, ctx) => {
				const intent = throughputTracker.finish(event.messages, nowMs);
				await executeRuntimePlan("agent_end", ctx, undefined, () => {
					if (!state) return;
					applyThroughputIntent(state, intent);
				});
			},
		},
	};
}
