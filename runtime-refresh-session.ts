import type { ExtensionContext, MessageEndEvent, MessageUpdateEvent, SessionCompactEvent } from "@earendil-works/pi-coding-agent";
import { lifecycleInputsFromContext, stateInputsFromContext, thinkingInputsFromContext, usageTotalsFromEntry, usageTotalsFromMessage, type StateInputs, type StateLifecycleInputs, type StateMessageInputs, type StateSessionEntry } from "./runtime-snapshot.js";
import {
	addUsageTotals,
	clearCurrentRunModelSpeed,
	createInitialState,
	refreshContextUsage,
	refreshModel,
	refreshWorkspace,
	setCurrentRunModelSpeed,
	setGitSnapshot,
	setLastRunModelSpeed,
	setProviderCount,
	setUsageTotals,
} from "./state.js";
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

type SnapshotMode = "none" | "reliable" | "lifecycle" | "thinking";
type GitRefreshMode = "never" | "onWorkspaceChange" | "immediate";
type RenderMode = "never" | "changed" | "always";

interface RefreshPlan {
	ensureConfig: boolean;
	ensureState: boolean;
	snapshot: SnapshotMode;
	refreshWorkspace: boolean;
	refreshModel: boolean;
	refreshUsageTotals: boolean;
	refreshContext: boolean;
	git: GitRefreshMode;
	render: RenderMode;
}

interface RefreshOptions {
	beforeRender?: () => boolean | void;
}

const ENSURE_ONLY: RefreshPlan = {
	ensureConfig: true,
	ensureState: true,
	snapshot: "none",
	refreshWorkspace: false,
	refreshModel: false,
	refreshUsageTotals: false,
	refreshContext: false,
	git: "never",
	render: "never",
};

const LIFECYCLE_MODEL_IMMEDIATE: RefreshPlan = {
	ensureConfig: true,
	ensureState: true,
	snapshot: "lifecycle",
	refreshWorkspace: true,
	refreshModel: true,
	refreshUsageTotals: false,
	refreshContext: true,
	git: "immediate",
	render: "changed",
};

const LIFECYCLE_MODEL_ON_WORKSPACE_CHANGE: RefreshPlan = {
	...LIFECYCLE_MODEL_IMMEDIATE,
	git: "onWorkspaceChange",
};

const RELIABLE_MODEL_IMMEDIATE: RefreshPlan = {
	...LIFECYCLE_MODEL_IMMEDIATE,
	snapshot: "reliable",
	refreshUsageTotals: true,
};

const LIFECYCLE_NO_MODEL_ON_WORKSPACE_CHANGE: RefreshPlan = {
	...LIFECYCLE_MODEL_ON_WORKSPACE_CHANGE,
	refreshModel: false,
};

const TOOL_EXECUTION_END: RefreshPlan = {
	...LIFECYCLE_MODEL_IMMEDIATE,
	refreshModel: false,
};

const ASSISTANT_MESSAGE_END: RefreshPlan = {
	...LIFECYCLE_NO_MODEL_ON_WORKSPACE_CHANGE,
};

const USAGE_MESSAGE_END: RefreshPlan = {
	...ENSURE_ONLY,
	render: "changed",
};

const THINKING_LEVEL_SELECT: RefreshPlan = {
	ensureConfig: true,
	ensureState: true,
	snapshot: "thinking",
	refreshWorkspace: false,
	refreshModel: true,
	refreshUsageTotals: false,
	refreshContext: false,
	git: "never",
	render: "changed",
};

const EDITOR_THINKING_CYCLE: RefreshPlan = {
	...THINKING_LEVEL_SELECT,
	ensureConfig: false,
	ensureState: false,
};

const CONFIG_SAVED: RefreshPlan = {
	...LIFECYCLE_MODEL_IMMEDIATE,
	ensureConfig: false,
	ensureState: false,
	render: "always",
};

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

	private resetAccumulators(): void {
		this.appliedUsageObjects = new WeakSet<object>();
		this.appliedUsageKeys = new Set<string>();
		this.modelSpeedTracker.reset();
	}

	private resetState(ctx: ExtensionContext): GlanceState {
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
		if (message.role === "assistant" && typeof message.responseId === "string" && message.responseId) return `assistant:${message.responseId}`;
		if (message.role === "toolResult" && typeof message.toolCallId === "string" && message.toolCallId) return `toolResult:${message.toolCallId}`;
		return undefined;
	}

	private entryUsageKey(entry: StateSessionEntry): string | undefined {
		return typeof entry.id === "string" && entry.id ? `${entry.type ?? "entry"}:${entry.id}` : undefined;
	}

	private applyGitScheduling(plan: RefreshPlan, workspaceChanged: boolean): void {
		if (plan.git === "immediate") this.host.scheduleGitRefresh(true);
		else if (plan.git === "onWorkspaceChange" && workspaceChanged) this.host.scheduleGitRefresh(true);
	}

	private applyLifecycleSnapshot(inputs: StateLifecycleInputs, plan: RefreshPlan, usage?: UsageTotals): boolean {
		if (!this.state) return false;
		let changed = false;
		const workspaceChanged = plan.refreshWorkspace ? refreshWorkspace(this.state, inputs) : false;
		changed = workspaceChanged || changed;
		changed = setProviderCount(this.state, inputs.availableProviderCount) || changed;
		if (plan.refreshModel) changed = refreshModel(this.state, inputs, this.host.getConfig()) || changed;
		if (plan.refreshUsageTotals && usage) changed = setUsageTotals(this.state, usage) || changed;
		if (plan.refreshContext) changed = refreshContextUsage(this.state, inputs) || changed;
		this.applyGitScheduling(plan, workspaceChanged);
		return changed;
	}

	private applyRefreshPlan(ctx: ExtensionContext, plan: RefreshPlan): boolean {
		if (!this.state || plan.snapshot === "none") return false;
		const config = this.host.getConfig();

		if (plan.snapshot === "thinking") {
			const inputs = thinkingInputsFromContext(ctx, this.host.getThinkingLevel());
			let changed = setProviderCount(this.state, inputs.availableProviderCount);
			if (plan.refreshModel) changed = refreshModel(this.state, inputs, config) || changed;
			return changed;
		}

		if (plan.snapshot === "reliable") {
			const inputs = stateInputsFromContext(ctx, this.host.getThinkingLevel());
			return this.applyLifecycleSnapshot(inputs, plan, inputs.usage);
		}

		return this.applyLifecycleSnapshot(lifecycleInputsFromContext(ctx, this.host.getThinkingLevel()), plan);
	}

	private async refresh(ctx: ExtensionContext, plan: RefreshPlan, options: RefreshOptions = {}): Promise<void> {
		if (plan.ensureConfig) await this.host.ensureConfig();
		let changed = false;
		if (plan.ensureState && !this.state) {
			this.ensureState(ctx);
			changed = true;
		}
		changed = this.applyRefreshPlan(ctx, plan) || changed;
		changed = options.beforeRender?.() === true || changed;
		if (plan.render === "always" || (plan.render === "changed" && changed)) this.host.requestRender();
	}

	async modelSelect(ctx: ExtensionContext): Promise<void> {
		await this.refresh(ctx, LIFECYCLE_MODEL_IMMEDIATE);
	}

	async thinkingLevelSelect(ctx: ExtensionContext): Promise<void> {
		await this.refresh(ctx, THINKING_LEVEL_SELECT);
	}

	async turnStart(ctx: ExtensionContext): Promise<void> {
		await this.refresh(ctx, LIFECYCLE_MODEL_ON_WORKSPACE_CHANGE);
	}

	async toolExecutionEnd(ctx: ExtensionContext): Promise<void> {
		await this.refresh(ctx, TOOL_EXECUTION_END);
	}

	async sessionTree(ctx: ExtensionContext): Promise<void> {
		await this.refresh(ctx, RELIABLE_MODEL_IMMEDIATE);
	}

	async configSaved(ctx: ExtensionContext, beforeRender?: () => void): Promise<void> {
		await this.refresh(ctx, CONFIG_SAVED, { beforeRender });
	}

	async editorThinkingCycle(ctx: ExtensionContext): Promise<void> {
		await this.refresh(ctx, EDITOR_THINKING_CYCLE);
	}

	messageUpdate(event: RuntimeMessageUpdateInput): void {
		this.modelSpeedTracker.messageUpdate(event.message, event.assistantMessageEvent, () => this.host.nowMs());
	}

	async messageEnd(event: RuntimeMessageEndInput, ctx: ExtensionContext): Promise<void> {
		const message = event.message;
		const hadState = this.state !== undefined;
		const delta = usageTotalsFromMessage(message);
		const modelSpeedIntent = this.modelSpeedTracker.messageEnd(message);
		const plan = message.role === "assistant"
			? ASSISTANT_MESSAGE_END
			: message.role === "toolResult" && !this.usageTotalsAreZero(delta)
				? USAGE_MESSAGE_END
				: ENSURE_ONLY;
		await this.refresh(ctx, plan, {
			beforeRender: () => {
				let changed = false;
				if (hadState) changed = this.applyUsageDelta(message, delta, this.messageUsageKey(message)) || changed;
				if (this.state) changed = applyModelSpeedIntent(this.state, modelSpeedIntent) || changed;
				return changed;
			},
		});
	}

	async sessionCompact(event: RuntimeSessionCompactInput, ctx: ExtensionContext): Promise<void> {
		const hadState = this.state !== undefined;
		const entry = event.compactionEntry;
		const delta = usageTotalsFromEntry(entry);
		const modelSpeedIntent = this.modelSpeedTracker.compactionRetry(event.willRetry === true);
		await this.refresh(ctx, LIFECYCLE_MODEL_IMMEDIATE, {
			beforeRender: () => {
				let changed = false;
				if (hadState) changed = this.applyUsageDelta(entry, delta, this.entryUsageKey(entry)) || changed;
				if (this.state) changed = applyModelSpeedIntent(this.state, modelSpeedIntent) || changed;
				return changed;
			},
		});
	}

	async turnEnd(_event: RuntimeTurnEndInput, ctx: ExtensionContext): Promise<void> {
		await this.refresh(ctx, LIFECYCLE_NO_MODEL_ON_WORKSPACE_CHANGE);
	}

	agentStart(): void {
		const intent = this.modelSpeedTracker.start();
		if (this.state && applyModelSpeedIntent(this.state, intent)) this.host.requestRender();
	}

	async agentEnd(_event: RuntimeAgentEndInput, ctx: ExtensionContext): Promise<void> {
		await this.refresh(ctx, LIFECYCLE_NO_MODEL_ON_WORKSPACE_CHANGE);
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
