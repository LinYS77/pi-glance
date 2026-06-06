import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GlanceEditor } from "./editor.js";
import { GlanceFooterBridge } from "./footer-bridge.js";
import { GitRefresher } from "./git.js";
import { runtimePlanFor, type RuntimeEventFacts, type RuntimeEventKind, type RuntimeRefreshPlan } from "./runtime-policy.js";
import { stateInputsFromContext } from "./runtime-snapshot.js";
import { clearContextUsage, clearCurrentRunThroughput, createInitialState, refreshContextUsage, refreshModel, refreshWorkspace, setCurrentRunThroughput, setGitSnapshot, setLastTurnThroughput, setUsageTotals } from "./state.js";
import { calculateTurnThroughput } from "./throughput.js";
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
	nowMs?: () => number;
}

interface MessageEndLikeEvent {
	message: {
		role?: string;
	};
}

interface TurnEndLikeEvent {
	turnIndex?: unknown;
	message?: unknown;
}

interface AgentEndLikeEvent {
	messages?: unknown;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isAssistantMessage(value: unknown): boolean {
	return isRecord(value) && value.role === "assistant";
}

function finiteTurnIndex(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function createGlanceRuntime(adapters: GlanceRuntimeAdapters): GlanceRuntime {
	let config: GlanceConfig | undefined;
	let state: GlanceState | undefined;
	let footerBridge: GlanceFooterBridge | undefined;
	let gitRefresher: RuntimeGitRefresher | undefined;
	let requestRender: (() => void) | undefined;
	let agentStartMs: number | null = null;
	let completedAssistantMessages: unknown[] = [];
	const seenTurnIndexes = new Set<number>();
	const nowMs = adapters.nowMs ?? Date.now;

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

	function resetRunAccumulator(startedAtMs: number | null = null): void {
		agentStartMs = startedAtMs;
		completedAssistantMessages = [];
		seenTurnIndexes.clear();
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

	function applySnapshotPlan(ctx: ExtensionContext, plan: RuntimeRefreshPlan): void {
		if (!state || plan.snapshot === "none") return;
		const inputs = stateInputsFromContext(ctx, adapters.getThinkingLevel());
		const workspaceChanged = plan.refreshWorkspace ? refreshWorkspace(state, inputs) : false;
		if (plan.refreshModel) refreshModel(state, inputs, getConfig());
		if (plan.refreshUsageTotals) setUsageTotals(state, inputs.usage);
		if (plan.context === "refresh") refreshContextUsage(state, inputs);
		else if (plan.context === "clear") clearContextUsage(state, inputs);
		if (plan.git === "immediate") scheduleGitRefresh(true);
		else if (plan.git === "onWorkspaceChange" && workspaceChanged) scheduleGitRefresh(true);
	}

	async function executeRuntimePlan(kind: RuntimeEventKind, ctx: ExtensionContext, facts?: RuntimeEventFacts, beforeRender?: () => void): Promise<void> {
		const plan = runtimePlanFor(kind, facts);
		if (plan.ensureConfig) await ensureConfig();
		if (plan.ensureState) ensureState(ctx);
		applySnapshotPlan(ctx, plan);
		beforeRender?.();
		if (plan.render) renderNow();
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
					void executeRuntimePlan("editor_thinking_cycle", ctx);
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
				await executeRuntimePlan("config_save_success", ctx, undefined, () => installInputSurface(ctx));
				ctx.ui.notify("pi-glance configuration saved", "info");
			},
		},
		events: {
			sessionStart: (_event, ctx) => {
				resetRunAccumulator();
				config = adapters.loadConfigSync();
				state = createInitialState(stateInputsFromContext(ctx, adapters.getThinkingLevel()), config);
				installInputSurface(ctx);
			},
			sessionShutdown: async (_event, ctx) => {
				resetRunAccumulator();
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
				await executeRuntimePlan("message_end", ctx, { messageRole: event.message.role });
			},
			turnEnd: async (event, ctx) => {
				await executeRuntimePlan("turn_end", ctx, undefined, () => {
					if (!state || agentStartMs === null) return;
					const turnIndex = finiteTurnIndex(event.turnIndex);
					if (turnIndex !== undefined && seenTurnIndexes.has(turnIndex)) return;
					if (!isAssistantMessage(event.message)) return;
					completedAssistantMessages.push(event.message);
					if (turnIndex !== undefined) seenTurnIndexes.add(turnIndex);
					const measurement = calculateTurnThroughput({
						startedAtMs: agentStartMs,
						endedAtMs: nowMs(),
						messages: completedAssistantMessages,
					});
					if (measurement) setCurrentRunThroughput(state, measurement);
					else clearCurrentRunThroughput(state);
				});
			},
			agentStart: (_event, _ctx) => {
				resetRunAccumulator(nowMs());
			},
			agentEnd: async (event, ctx) => {
				const startedAtMs = agentStartMs;
				agentStartMs = null;
				const endedAtMs = startedAtMs === null ? null : nowMs();
				try {
					await executeRuntimePlan("agent_end", ctx, undefined, () => {
						if (!state) return;
						const messages = Array.isArray(event.messages) ? event.messages : undefined;
						const measurement = startedAtMs !== null && endedAtMs !== null && messages
							? calculateTurnThroughput({ startedAtMs, endedAtMs, messages })
							: undefined;
						if (measurement) setLastTurnThroughput(state, measurement);
						clearCurrentRunThroughput(state);
					});
				} finally {
					resetRunAccumulator();
				}
			},
		},
	};
}
