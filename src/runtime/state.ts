import { displayDirectory, shortenModel } from "../surface/format.js";
import { emptyGitSnapshot, gitSnapshotsEqual } from "./git-snapshot.js";
import type { StateInputs } from "./snapshot.js";
import type { GitSnapshot, GlanceConfig, GlanceState, ModelSpeedMeasurement, UsageTotals } from "../types.js";

export function createInitialState(inputs: StateInputs, config: GlanceConfig): GlanceState {
	const state: GlanceState = {
		workspace: {
			name: displayDirectory(inputs.cwd),
			path: inputs.cwd,
		},
		git: emptyGitSnapshot(),
		providers: {
			availableCount: inputs.availableProviderCount,
		},
		model: {
			id: inputs.model?.id,
			provider: inputs.model?.provider,
			displayName: shortenModel(inputs.model?.id, config.model.customNames, inputs.model?.name),
			thinking: inputs.thinkingLevel,
		},
		context: {
			tokens: null,
			window: inputs.model?.contextWindow ?? 0,
			percent: null,
		},
		usage: inputs.usage,
		throughput: {
			lastRun: null,
			currentRun: null,
		},
		version: 0,
	};
	refreshContextUsage(state, inputs);
	return state;
}

function touch(state: GlanceState): void {
	state.version++;
}

function usageTotalsEqual(a: UsageTotals, b: UsageTotals): boolean {
	return a.input === b.input && a.output === b.output && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite && a.cost === b.cost;
}

function modelSpeedEqual(a: ModelSpeedMeasurement | null, b: ModelSpeedMeasurement | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.outputTokens === b.outputTokens &&
		a.elapsedMs === b.elapsedMs &&
		a.tokensPerSecond === b.tokensPerSecond
	);
}

export function setLastRunModelSpeed(state: GlanceState, next: ModelSpeedMeasurement | null): boolean {
	if (modelSpeedEqual(state.throughput.lastRun, next)) return false;
	state.throughput.lastRun = next;
	touch(state);
	return true;
}

export function setCurrentRunModelSpeed(state: GlanceState, next: ModelSpeedMeasurement | null): boolean {
	if (modelSpeedEqual(state.throughput.currentRun, next)) return false;
	state.throughput.currentRun = next;
	touch(state);
	return true;
}

export function clearCurrentRunModelSpeed(state: GlanceState): boolean {
	return setCurrentRunModelSpeed(state, null);
}

export function setUsageTotals(state: GlanceState, usage: Readonly<UsageTotals>): boolean {
	if (usageTotalsEqual(state.usage, usage)) return false;
	state.usage = usage;
	touch(state);
	return true;
}

export function setProviderCount(state: GlanceState, availableCount: number): boolean {
	if (state.providers.availableCount === availableCount) return false;
	state.providers.availableCount = availableCount;
	touch(state);
	return true;
}

export function refreshWorkspace(state: GlanceState, inputs: Pick<StateInputs, "cwd">): boolean {
	const cwd = inputs.cwd;
	if (state.workspace.path === cwd) return false;
	state.workspace = {
		name: displayDirectory(cwd),
		path: cwd,
	};
	state.git = emptyGitSnapshot();
	touch(state);
	return true;
}

export function setGitSnapshot(state: GlanceState, cwd: string, snapshot: GitSnapshot): boolean {
	if (state.workspace.path !== cwd) return false;
	if (gitSnapshotsEqual(state.git, snapshot)) {
		state.git.updatedAt = snapshot.updatedAt;
		return false;
	}
	state.git = snapshot;
	touch(state);
	return true;
}

export function refreshContextUsage(state: GlanceState, inputs: Pick<StateInputs, "contextUsage" | "model">): boolean {
	const usage = inputs.contextUsage;
	const tokens = usage?.tokens ?? null;
	const window = usage?.contextWindow ?? inputs.model?.contextWindow ?? 0;
	const percent = usage?.percent ?? null;
	if (state.context.tokens === tokens && state.context.window === window && state.context.percent === percent) return false;
	state.context.tokens = tokens;
	state.context.window = window;
	state.context.percent = percent;
	touch(state);
	return true;
}

export function refreshModel(state: GlanceState, inputs: Pick<StateInputs, "model" | "thinkingLevel">, config: GlanceConfig): boolean {
	const id = inputs.model?.id;
	const provider = inputs.model?.provider;
	const displayName = shortenModel(inputs.model?.id, config.model.customNames, inputs.model?.name);
	// Selection metadata does not own Context: virtual and physical limits can differ.
	if (
		state.model.id === id &&
		state.model.provider === provider &&
		state.model.displayName === displayName &&
		state.model.thinking === inputs.thinkingLevel
	) {
		return false;
	}
	state.model.id = id;
	state.model.provider = provider;
	state.model.displayName = displayName;
	state.model.thinking = inputs.thinkingLevel;
	touch(state);
	return true;
}
