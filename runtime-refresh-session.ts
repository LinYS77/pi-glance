import type { ExtensionContext, MessageEndEvent, MessageUpdateEvent, SessionCompactEvent } from "@earendil-works/pi-coding-agent";
import { applyRuntimeRefreshPlan } from "./runtime-plan-executor.js";
import { runtimePlanFor, type RuntimeEventFacts, type RuntimeEventKind } from "./runtime-policy.js";
import { stateInputsFromContext, usageTotalsFromEntry, usageTotalsFromMessage, type StateInputs, type StateMessageInputs, type StateSessionEntry } from "./runtime-snapshot.js";
import { addUsageTotals, clearCurrentRunModelSpeed, createInitialState, setCurrentRunModelSpeed, setGitSnapshot, setLastRunModelSpeed } from "./state.js";
import { ModelSpeedRunTracker, type ModelSpeedStateIntent } from "./throughput-run-tracker.js";
import type { GitSnapshot, GlanceConfig, GlanceState, UsageTotals } from "./types.js";

export interface RuntimeMessageUpdateInput {
	type?: MessageUpdateEvent["type"];
	message: StateMessageInputs;
	assistantMessageEvent: { type: MessageUpdateEvent["assistantMessageEvent"]["type"] };
}

export interface RuntimeMessageEndInput {
	type?: MessageEndEvent["type"];
	message: StateMessageInputs;
}

export interface RuntimeSessionCompactInput {
	type?: SessionCompactEvent["type"];
	compactionEntry: StateSessionEntry;
	willRetry?: boolean;
}

export interface RuntimeTurnEndInput {
	turnIndex?: unknown;
	message?: unknown;
}

export interface RuntimeAgentEndInput {
	messages?: unknown;
}

export interface RuntimeRefreshSessionHost {
	getConfig(): GlanceConfig;
	ensureConfig(): Promise<GlanceConfig>;
	getThinkingLevel(): string;
	nowMs(): number;
	requestRender(): void;
	scheduleGitRefresh(immediate?: boolean): void;
}

export interface RuntimeRefreshExecuteOptions {
	facts?: RuntimeEventFacts;
	beforeRender?: () => void;
}

function applyModelSpeedIntent(state: GlanceState, intent: ModelSpeedStateIntent): boolean {
	switch (intent.kind) {
		case "none":
			return false;
		case "set-current-run":
			return setCurrentRunModelSpeed(state, intent.currentRun);
		case "clear-current-run":
			return clearCurrentRunModelSpeed(state);
		case "set-last-run-and-clear-current-run": {
			const lastRunChanged = setLastRunModelSpeed(state, intent.lastRun);
			const currentRunChanged = clearCurrentRunModelSpeed(state);
			return lastRunChanged || currentRunChanged;
		}
	}
}

export class RuntimeRefreshSession {
	private state?: GlanceState;
	private appliedUsageObjects = new WeakSet<object>();
	private appliedUsageKeys = new Set<string>();
	private readonly modelSpeedTracker = new ModelSpeedRunTracker();

	constructor(private readonly host: RuntimeRefreshSessionHost) {}

	getState(): GlanceState | undefined {
		return this.state;
	}

	private readStateInputs(ctx: ExtensionContext): StateInputs {
		return stateInputsFromContext(ctx, this.host.getThinkingLevel());
	}

	resetAccumulators(): void {
		this.appliedUsageObjects = new WeakSet<object>();
		this.appliedUsageKeys = new Set<string>();
		this.modelSpeedTracker.reset();
	}

	resetState(ctx: ExtensionContext): GlanceState {
		this.state = createInitialState(this.readStateInputs(ctx), this.host.getConfig());
		return this.state;
	}

	sessionStart(ctx: ExtensionContext): GlanceState {
		this.resetAccumulators();
		return this.resetState(ctx);
	}

	sessionShutdown(): void {
		this.resetAccumulators();
	}

	ensureState(ctx: ExtensionContext): GlanceState {
		this.state ??= createInitialState(this.readStateInputs(ctx), this.host.getConfig());
		return this.state;
	}

	private usageTotalsAreZero(delta: UsageTotals): boolean {
		return delta.input === 0 && delta.output === 0 && delta.cacheRead === 0 && delta.cacheWrite === 0 && delta.cost === 0;
	}

	private claimUsageDelta(source: object, key: string | undefined): boolean {
		if (key) {
			if (this.appliedUsageKeys.has(key)) return false;
			this.appliedUsageKeys.add(key);
			return true;
		}
		if (this.appliedUsageObjects.has(source)) return false;
		this.appliedUsageObjects.add(source);
		return true;
	}

	private applyUsageDelta(source: object, delta: UsageTotals, key?: string): boolean {
		if (!this.state || this.usageTotalsAreZero(delta) || !this.claimUsageDelta(source, key)) return false;
		return addUsageTotals(this.state, delta);
	}

	private messageUsageKey(message: StateMessageInputs): string | undefined {
		if (message.role === "assistant" && typeof message.responseId === "string" && message.responseId) {
			return `assistant:${message.responseId}`;
		}
		if (message.role === "toolResult" && typeof message.toolCallId === "string" && message.toolCallId) {
			return `toolResult:${message.toolCallId}`;
		}
		return undefined;
	}

	private entryUsageKey(entry: StateSessionEntry): string | undefined {
		return typeof entry.id === "string" && entry.id ? `${entry.type ?? "entry"}:${entry.id}` : undefined;
	}

	async execute(kind: RuntimeEventKind, ctx: ExtensionContext, options: RuntimeRefreshExecuteOptions = {}): Promise<void> {
		const plan = runtimePlanFor(kind, options.facts);
		if (plan.ensureConfig) await this.host.ensureConfig();
		if (plan.ensureState) this.ensureState(ctx);
		if (this.state) {
			applyRuntimeRefreshPlan({
				state: this.state,
				config: this.host.getConfig(),
				ctx,
				plan,
				getThinkingLevel: () => this.host.getThinkingLevel(),
				scheduleGitRefresh: (immediate) => this.host.scheduleGitRefresh(immediate),
			});
		}
		options.beforeRender?.();
		if (plan.render) this.host.requestRender();
	}

	messageUpdate(event: RuntimeMessageUpdateInput): void {
		this.modelSpeedTracker.messageUpdate(event.message, event.assistantMessageEvent, () => this.host.nowMs());
	}

	async messageEnd(event: RuntimeMessageEndInput, ctx: ExtensionContext): Promise<void> {
		const message = event.message;
		const hadState = this.state !== undefined;
		const delta = usageTotalsFromMessage(message);
		const modelSpeedIntent = this.modelSpeedTracker.messageEnd(event.message);
		await this.execute("message_end", ctx, {
			facts: { messageRole: message.role, messageHasUsage: !this.usageTotalsAreZero(delta) },
			beforeRender: () => {
				if (hadState) this.applyUsageDelta(event.message, delta, this.messageUsageKey(message));
				if (this.state) applyModelSpeedIntent(this.state, modelSpeedIntent);
			},
		});
	}

	async sessionCompact(event: RuntimeSessionCompactInput, ctx: ExtensionContext): Promise<void> {
		const hadState = this.state !== undefined;
		const entry = event.compactionEntry as StateSessionEntry;
		const delta = usageTotalsFromEntry(entry);
		const modelSpeedIntent = this.modelSpeedTracker.compactionRetry(event.willRetry === true);
		await this.execute("session_compact", ctx, {
			beforeRender: () => {
				if (hadState) this.applyUsageDelta(event.compactionEntry, delta, this.entryUsageKey(entry));
				if (this.state) applyModelSpeedIntent(this.state, modelSpeedIntent);
			},
		});
	}

	async turnEnd(_event: RuntimeTurnEndInput, ctx: ExtensionContext): Promise<void> {
		await this.execute("turn_end", ctx);
	}

	agentStart(): void {
		const intent = this.modelSpeedTracker.start();
		if (this.state && applyModelSpeedIntent(this.state, intent)) this.host.requestRender();
	}

	async agentEnd(_event: RuntimeAgentEndInput, ctx: ExtensionContext): Promise<void> {
		await this.execute("agent_end", ctx);
	}

	agentSettled(): void {
		const intent = this.modelSpeedTracker.settle();
		if (this.state && applyModelSpeedIntent(this.state, intent)) this.host.requestRender();
	}

	applyGitSnapshot(cwd: string, snapshot: GitSnapshot): boolean {
		if (!this.state || !setGitSnapshot(this.state, cwd, snapshot)) return false;
		this.host.requestRender();
		return true;
	}
}
