import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyRuntimeRefreshPlan } from "./runtime-plan-executor.js";
import { runtimePlanFor, type RuntimeEventFacts, type RuntimeEventKind } from "./runtime-policy.js";
import { assistantMessageHasKnownContextUsage, stateInputsFromContext, type StateInputs, type StateMessageInputs } from "./runtime-snapshot.js";
import { createInitialState, setGitSnapshot } from "./state.js";
import type { GitSnapshot, GlanceConfig, GlanceState } from "./types.js";

export interface RuntimeRefreshSessionHost {
	getConfig(): GlanceConfig;
	ensureConfig(): Promise<GlanceConfig>;
	getThinkingLevel(): string;
	requestRender(): void;
	scheduleGitRefresh(immediate?: boolean): void;
}

export interface RuntimeRefreshExecuteOptions {
	facts?: RuntimeEventFacts;
	beforeRender?: () => void;
}

export class RuntimeRefreshSession {
	private state?: GlanceState;
	private unknownContextAfterLatestCompaction = false;

	constructor(private readonly host: RuntimeRefreshSessionHost) {}

	getState(): GlanceState | undefined {
		return this.state;
	}

	private setUnknownContextAfterLatestCompaction(value: boolean): void {
		this.unknownContextAfterLatestCompaction = value;
	}

	private readStateInputs(ctx: ExtensionContext): StateInputs {
		const inputs = stateInputsFromContext(ctx, this.host.getThinkingLevel());
		this.setUnknownContextAfterLatestCompaction(inputs.unknownContextAfterLatestCompaction);
		return inputs;
	}

	resetState(ctx: ExtensionContext): GlanceState {
		this.state = createInitialState(this.readStateInputs(ctx), this.host.getConfig());
		return this.state;
	}

	ensureState(ctx: ExtensionContext): GlanceState {
		this.state ??= createInitialState(this.readStateInputs(ctx), this.host.getConfig());
		return this.state;
	}

	clearContextUnknownAfterKnownAssistantUsage(message: StateMessageInputs): void {
		if (this.unknownContextAfterLatestCompaction && assistantMessageHasKnownContextUsage(message)) {
			this.unknownContextAfterLatestCompaction = false;
		}
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
				unknownContextAfterLatestCompaction: this.unknownContextAfterLatestCompaction,
				setUnknownContextAfterLatestCompaction: (value) => this.setUnknownContextAfterLatestCompaction(value),
				scheduleGitRefresh: (immediate) => this.host.scheduleGitRefresh(immediate),
			});
		}
		options.beforeRender?.();
		if (plan.render) this.host.requestRender();
	}

	applyGitSnapshot(cwd: string, snapshot: GitSnapshot): boolean {
		if (!this.state || !setGitSnapshot(this.state, cwd, snapshot)) return false;
		this.host.requestRender();
		return true;
	}
}
