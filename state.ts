import { displayDirectory, shortenModel } from "./format.js";
import { emptyGitSnapshot } from "./git.js";
import type { StateInputs } from "./runtime-snapshot.js";
import type { GitSnapshot, GlanceConfig, GlanceState, ModelSpeedMeasurement, UsageTotals } from "./types.js";

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
		a.startedAtMs === b.startedAtMs &&
		a.endedAtMs === b.endedAtMs &&
		a.elapsedMs === b.elapsedMs &&
		a.tokensPerSecond === b.tokensPerSecond &&
		a.usage.input === b.usage.input &&
		a.usage.output === b.usage.output &&
		a.usage.cacheRead === b.usage.cacheRead &&
		a.usage.cacheWrite === b.usage.cacheWrite &&
		a.usage.totalTokens === b.usage.totalTokens &&
		a.usage.assistantMessages === b.usage.assistantMessages
	);
}

export function setLastRunModelSpeed(state: GlanceState, next: ModelSpeedMeasurement | null): boolean {
	if (modelSpeedEqual(state.throughput.lastRun, next)) return false;
	state.throughput.lastRun = next;
	touch(state);
	return true;
}

export function clearLastRunModelSpeed(state: GlanceState): boolean {
	return setLastRunModelSpeed(state, null);
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

export function setUsageTotals(state: GlanceState, usage: UsageTotals): boolean {
	if (usageTotalsEqual(state.usage, usage)) return false;
	state.usage = usage;
	touch(state);
	return true;
}

export function addUsageTotals(state: GlanceState, delta: UsageTotals): boolean {
	if (delta.input === 0 && delta.output === 0 && delta.cacheRead === 0 && delta.cacheWrite === 0 && delta.cost === 0) return false;
	state.usage = {
		input: state.usage.input + delta.input,
		output: state.usage.output + delta.output,
		cacheRead: state.usage.cacheRead + delta.cacheRead,
		cacheWrite: state.usage.cacheWrite + delta.cacheWrite,
		cost: state.usage.cost + delta.cost,
	};
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

function gitSnapshotsEqual(a: GitSnapshot, b: GitSnapshot): boolean {
	return (
		a.repo === b.repo &&
		a.branch === b.branch &&
		a.detached === b.detached &&
		a.sha === b.sha &&
		a.upstream === b.upstream &&
		a.ahead === b.ahead &&
		a.behind === b.behind &&
		a.staged === b.staged &&
		a.unstaged === b.unstaged &&
		a.untracked === b.untracked &&
		a.conflicts === b.conflicts &&
		a.dirty === b.dirty &&
		a.status === b.status
	);
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
	const window = inputs.model?.contextWindow ?? state.context.window;
	if (
		state.model.id === id &&
		state.model.provider === provider &&
		state.model.displayName === displayName &&
		state.model.thinking === inputs.thinkingLevel &&
		state.context.window === window
	) {
		return false;
	}
	state.model.id = id;
	state.model.provider = provider;
	state.model.displayName = displayName;
	state.model.thinking = inputs.thinkingLevel;
	state.context.window = window;
	touch(state);
	return true;
}
