import type { ExtensionContext, MessageEndEvent, SessionCompactEvent } from "@earendil-works/pi-coding-agent";
import { BilledSessionLedger, type StateMessageInputs, type StateSessionEntry } from "./billed-session-ledger.js";
import { contextUsageInputsFromContext, lifecycleInputsFromContext, thinkingInputsFromContext, type StateContextUsageInputs, type StateInputs, type StateLifecycleInputs } from "./snapshot.js";
import {
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
import type { GitSnapshot, GlanceConfig, GlanceState } from "../types.js";

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
type GitRefreshMode = "never" | "onWorkspaceChange" | "immediate" | "afterTool";
type RenderMode = "never" | "changed" | "always";

interface RefreshPlan {
	ensureConfig: boolean;
	ensureState: boolean;
	snapshot: SnapshotMode;
	refreshWorkspace: boolean;
	refreshModel: boolean;
	refreshContext: boolean;
	git: GitRefreshMode;
	render: RenderMode;
}

interface RefreshOptions {
	forceContext?: boolean;
	beforeRender?: () => boolean | void;
}

const ENSURE_ONLY: RefreshPlan = {
	ensureConfig: true,
	ensureState: true,
	snapshot: "none",
	refreshWorkspace: false,
	refreshModel: false,
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
};

const LIFECYCLE_NO_MODEL_ON_WORKSPACE_CHANGE: RefreshPlan = {
	...LIFECYCLE_MODEL_ON_WORKSPACE_CHANGE,
	refreshModel: false,
};

const TOOL_EXECUTION_END: RefreshPlan = {
	...LIFECYCLE_MODEL_IMMEDIATE,
	refreshModel: false,
	git: "afterTool",
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
	refreshContext: false,
	git: "never",
	render: "changed",
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
	private contextSnapshot?: {
		manager: ExtensionContext["sessionManager"];
		leafId: string;
		model: ExtensionContext["model"];
		modelId: string | undefined;
		provider: string | undefined;
		window: number | undefined;
		usage: StateContextUsageInputs | undefined;
	};
	private billedSession = new BilledSessionLedger();
	private readonly modelSpeedTracker = new ModelSpeedRunTracker();

	constructor(private readonly host: RuntimeRefreshSessionHost) {}

	getState(): GlanceState | undefined {
		return this.state;
	}

	/** Reuse only within a stable persisted position and selected model. */
	private readContextUsage(ctx: ExtensionContext, force = false): StateContextUsageInputs | undefined {
		const manager = ctx.sessionManager, leafId = manager.getLeafId(), model = ctx.model;
		const previous = this.contextSnapshot;
		if (!force && leafId && previous?.manager === manager && previous.leafId === leafId
			&& previous.model === model && previous.modelId === model?.id
			&& previous.provider === model?.provider && previous.window === model?.contextWindow) return previous.usage;
		const usage = contextUsageInputsFromContext(ctx);
		this.contextSnapshot = leafId ? { manager, leafId, model, modelId: model?.id,
			provider: model?.provider, window: model?.contextWindow, usage } : undefined;
		return usage;
	}

	private readStateInputs(ctx: ExtensionContext): StateInputs {
		const usage = this.billedSession.rebuild(ctx.sessionManager.getEntries());
		return {
			...lifecycleInputsFromContext(ctx, this.host.getThinkingLevel(), () => this.readContextUsage(ctx, true)),
			usage,
		};
	}

	private resetAccumulators(): void {
		this.contextSnapshot = undefined;
		this.billedSession = new BilledSessionLedger();
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
		this.state = undefined;
	}

	ensureState(ctx: ExtensionContext): GlanceState {
		if (!this.state) return this.resetState(ctx);
		this.syncPersistedUsage(ctx);
		return this.state;
	}

	private syncPersistedUsage(ctx: ExtensionContext): boolean {
		return this.billedSession.advance(ctx.sessionManager) && this.publishBilledUsage();
	}

	private publishBilledUsage(): boolean {
		return this.state !== undefined && setUsageTotals(this.state, this.billedSession.totals);
	}

	private applyGitScheduling(plan: RefreshPlan, workspaceChanged: boolean): void {
		if (plan.git === "afterTool") this.host.scheduleGitRefresh(workspaceChanged);
		else if (plan.git === "immediate") this.host.scheduleGitRefresh(true);
		else if (plan.git === "onWorkspaceChange" && workspaceChanged) this.host.scheduleGitRefresh(true);
	}

	private applyLifecycleSnapshot(inputs: StateLifecycleInputs, plan: RefreshPlan): boolean {
		if (!this.state) return false;
		let changed = false;
		const workspaceChanged = plan.refreshWorkspace ? refreshWorkspace(this.state, inputs) : false;
		changed = workspaceChanged || changed;
		changed = setProviderCount(this.state, inputs.availableProviderCount) || changed;
		if (plan.refreshModel) changed = refreshModel(this.state, inputs, this.host.getConfig()) || changed;
		if (plan.refreshContext) changed = refreshContextUsage(this.state, inputs) || changed;
		this.applyGitScheduling(plan, workspaceChanged);
		return changed;
	}

	private applyRefreshPlan(ctx: ExtensionContext, plan: RefreshPlan, forceContext = false): boolean {
		if (!this.state || plan.snapshot === "none") return false;
		const config = this.host.getConfig();

		if (plan.snapshot === "thinking") {
			const inputs = thinkingInputsFromContext(ctx, this.host.getThinkingLevel());
			let changed = setProviderCount(this.state, inputs.availableProviderCount);
			if (plan.refreshModel) changed = refreshModel(this.state, inputs, config) || changed;
			return changed;
		}

		if (plan.snapshot === "reliable") {
			const inputs = this.readStateInputs(ctx);
			const usageChanged = this.publishBilledUsage();
			return this.applyLifecycleSnapshot(inputs, plan) || usageChanged;
		}

		return this.applyLifecycleSnapshot(lifecycleInputsFromContext(ctx, this.host.getThinkingLevel(), () => this.readContextUsage(ctx, forceContext)), plan);
	}

	private async refresh(ctx: ExtensionContext, plan: RefreshPlan, options: RefreshOptions = {}): Promise<void> {
		if (plan.ensureConfig) await this.host.ensureConfig();
		let changed = false;
		if (plan.ensureState && !this.state) {
			this.ensureState(ctx);
			changed = true;
		}
		changed = this.applyRefreshPlan(ctx, plan, options.forceContext) || changed;
		changed = options.beforeRender?.() === true || changed;
		if (plan.render === "always" || (plan.render === "changed" && changed)) this.host.requestRender();
	}

	async modelSelect(ctx: ExtensionContext): Promise<void> {
		await this.refresh(ctx, LIFECYCLE_MODEL_IMMEDIATE, { forceContext: true });
	}

	async thinkingLevelSelect(ctx: ExtensionContext): Promise<void> {
		this.contextSnapshot = undefined;
		await this.refresh(ctx, THINKING_LEVEL_SELECT);
	}

	async turnStart(ctx: ExtensionContext): Promise<void> {
		this.modelSpeedTracker.turnStart();
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

	providerRequest(): void {
		this.modelSpeedTracker.requestStart(() => this.host.nowMs());
	}

	uiPromptStart(): void {
		this.modelSpeedTracker.uiPromptStart(() => this.host.nowMs());
	}

	uiPromptEnd(): void {
		this.modelSpeedTracker.uiPromptEnd(() => this.host.nowMs());
	}

	async messageEnd(event: RuntimeMessageEndInput, ctx: ExtensionContext): Promise<void> {
		const message = event.message;
		const billed = this.state !== undefined && this.billedSession.recordMessage(message);
		const modelSpeedIntent = this.modelSpeedTracker.messageEnd(message, () => this.host.nowMs());
		const plan = message.role === "assistant"
			? ASSISTANT_MESSAGE_END
			: billed ? USAGE_MESSAGE_END : ENSURE_ONLY;
		await this.refresh(ctx, plan, {
			forceContext: message.role === "assistant",
			beforeRender: () => {
				let changed = billed && this.publishBilledUsage();
				if (this.state) changed = applyModelSpeedIntent(this.state, modelSpeedIntent) || changed;
				return changed;
			},
		});
	}

	async sessionCompact(event: RuntimeSessionCompactInput, ctx: ExtensionContext): Promise<void> {
		const hadState = this.state !== undefined;
		const entry = event.compactionEntry;
		const modelSpeedIntent = this.modelSpeedTracker.compactionRetry(event.willRetry === true);
		await this.refresh(ctx, LIFECYCLE_MODEL_IMMEDIATE, {
			forceContext: true,
			beforeRender: () => {
				let changed = hadState && this.billedSession.recordBoundary(entry) && this.publishBilledUsage();
				if (this.state) changed = applyModelSpeedIntent(this.state, modelSpeedIntent) || changed;
				return changed;
			},
		});
	}

	async turnEnd(_event: RuntimeTurnEndInput, ctx: ExtensionContext): Promise<void> {
		await this.refresh(ctx, LIFECYCLE_NO_MODEL_ON_WORKSPACE_CHANGE);
	}

	agentStart(): void {
		this.contextSnapshot = undefined;
		const intent = this.modelSpeedTracker.start();
		if (this.state && applyModelSpeedIntent(this.state, intent)) this.host.requestRender();
	}

	async agentEnd(_event: RuntimeAgentEndInput, ctx: ExtensionContext): Promise<void> {
		await this.refresh(ctx, LIFECYCLE_NO_MODEL_ON_WORKSPACE_CHANGE);
	}

	agentSettled(ctx: ExtensionContext): void {
		const intent = this.modelSpeedTracker.settle();
		if (!this.state) return;
		let changed = this.syncPersistedUsage(ctx);
		changed = refreshContextUsage(this.state, { contextUsage: this.readContextUsage(ctx, true), model: ctx.model }) || changed;
		changed = applyModelSpeedIntent(this.state, intent) || changed;
		if (changed) this.host.requestRender();
	}

	applyGitSnapshot(cwd: string, snapshot: GitSnapshot): boolean {
		if (!this.state || !setGitSnapshot(this.state, cwd, snapshot)) return false;
		this.host.requestRender();
		return true;
	}
}
