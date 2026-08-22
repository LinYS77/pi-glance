import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RuntimeRefreshPlan } from "./runtime-policy.js";
import { lifecycleInputsFromContext, stateInputsFromContext, thinkingInputsFromContext } from "./runtime-snapshot.js";
import { refreshContextUsage, refreshModel, refreshWorkspace, setProviderCount, setUsageTotals } from "./state.js";
import type { GlanceConfig, GlanceState } from "./types.js";

export interface RuntimePlanExecutionInput {
	state: GlanceState;
	config: GlanceConfig;
	ctx: ExtensionContext;
	plan: RuntimeRefreshPlan;
	getThinkingLevel(): string;
	scheduleGitRefresh(immediate?: boolean): void;
}

function applyGitScheduling(input: RuntimePlanExecutionInput, workspaceChanged: boolean): void {
	if (input.plan.git === "immediate") input.scheduleGitRefresh(true);
	else if (input.plan.git === "onWorkspaceChange" && workspaceChanged) input.scheduleGitRefresh(true);
}

export function applyRuntimeRefreshPlan(input: RuntimePlanExecutionInput): void {
	const { state, config, ctx, plan } = input;
	if (plan.snapshot === "none") return;

	if (plan.snapshot === "thinking") {
		const inputs = thinkingInputsFromContext(ctx, input.getThinkingLevel());
		setProviderCount(state, inputs.availableProviderCount);
		if (plan.refreshModel) refreshModel(state, inputs, config);
		return;
	}

	if (plan.snapshot === "lifecycle") {
		const inputs = lifecycleInputsFromContext(ctx, input.getThinkingLevel());
		const workspaceChanged = plan.refreshWorkspace ? refreshWorkspace(state, inputs) : false;
		setProviderCount(state, inputs.availableProviderCount);
		if (plan.refreshModel) refreshModel(state, inputs, config);
		if (plan.context === "refresh") refreshContextUsage(state, inputs);
		applyGitScheduling(input, workspaceChanged);
		return;
	}

	if (plan.snapshot === "reliable") {
		const inputs = stateInputsFromContext(ctx, input.getThinkingLevel());
		const workspaceChanged = plan.refreshWorkspace ? refreshWorkspace(state, inputs) : false;
		setProviderCount(state, inputs.availableProviderCount);
		if (plan.refreshModel) refreshModel(state, inputs, config);
		if (plan.refreshUsageTotals) setUsageTotals(state, inputs.usage);
		if (plan.context === "refresh") refreshContextUsage(state, inputs);
		applyGitScheduling(input, workspaceChanged);
	}
}
