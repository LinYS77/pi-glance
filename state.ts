import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { displayDirectory, shortenModel } from "./format.js";
import { emptyGitSnapshot } from "./git.js";
import type { GitSnapshot, GlanceConfig, GlanceState, UsageTotals } from "./types.js";

export function createInitialState(ctx: ExtensionContext, config: GlanceConfig, thinkingLevel: string): GlanceState {
	const cwd = ctx.sessionManager.getCwd() || ctx.cwd;
	const state: GlanceState = {
		workspace: {
			name: displayDirectory(cwd),
			path: cwd,
		},
		git: emptyGitSnapshot(),
		providers: {
			availableCount: 1,
		},
		model: {
			id: ctx.model?.id,
			provider: ctx.model?.provider,
			displayName: shortenModel(ctx.model?.id, config.model.customNames),
			thinking: thinkingLevel,
		},
		context: {
			tokens: null,
			window: ctx.model?.contextWindow ?? 0,
			percent: null,
		},
		usage: computeUsageTotals(ctx),
		version: 0,
	};
	refreshContextUsage(state, ctx);
	return state;
}

function touch(state: GlanceState): void {
	state.version++;
}

function usageCost(message: AssistantMessage): number {
	const cost = message.usage?.cost;
	if (!cost) return 0;
	if (Number.isFinite(cost.total)) return cost.total;
	return (cost.input ?? 0) + (cost.output ?? 0) + (cost.cacheRead ?? 0) + (cost.cacheWrite ?? 0);
}

function usageTotalsEqual(a: UsageTotals, b: UsageTotals): boolean {
	return a.input === b.input && a.output === b.output && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite && a.cost === b.cost;
}

export function computeUsageTotals(ctx: ExtensionContext): UsageTotals {
	const usage: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const message = entry.message as AssistantMessage;
		usage.input += message.usage?.input ?? 0;
		usage.output += message.usage?.output ?? 0;
		usage.cacheRead += message.usage?.cacheRead ?? 0;
		usage.cacheWrite += message.usage?.cacheWrite ?? 0;
		usage.cost += usageCost(message);
	}
	return usage;
}

export function setUsageTotals(state: GlanceState, usage: UsageTotals): boolean {
	if (usageTotalsEqual(state.usage, usage)) return false;
	state.usage = usage;
	touch(state);
	return true;
}

export function clearContextUsage(state: GlanceState, ctx?: ExtensionContext): boolean {
	const window = ctx?.model?.contextWindow ?? state.context.window ?? 0;
	if (state.context.tokens === null && state.context.percent === null && state.context.window === window) return false;
	state.context.tokens = null;
	state.context.window = window;
	state.context.percent = null;
	touch(state);
	return true;
}

export function refreshWorkspace(state: GlanceState, ctx: ExtensionContext): boolean {
	const cwd = ctx.sessionManager.getCwd() || ctx.cwd;
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

function assistantContextTokens(message: AssistantMessage): number {
	const usage = message.usage as
		| {
				totalTokens?: number;
				input?: number;
				output?: number;
				cacheRead?: number;
				cacheWrite?: number;
		  }
		| undefined;
	if (!usage) return 0;
	if (Number.isFinite(usage.totalTokens)) return usage.totalTokens ?? 0;
	return (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

function hasUnknownContextAfterLatestCompaction(ctx: ExtensionContext): boolean {
	const branch = ctx.sessionManager.getBranch();
	let compactionIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i]?.type === "compaction") {
			compactionIndex = i;
			break;
		}
	}
	if (compactionIndex < 0) return false;

	for (let i = branch.length - 1; i > compactionIndex; i--) {
		const entry = branch[i];
		if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
		const message = entry.message as AssistantMessage;
		if (message.stopReason === "aborted" || message.stopReason === "error") return true;
		return assistantContextTokens(message) <= 0;
	}

	return true;
}

export function refreshContextUsage(state: GlanceState, ctx: ExtensionContext): boolean {
	const usage = ctx.getContextUsage();
	const unknownAfterCompaction = hasUnknownContextAfterLatestCompaction(ctx);
	const tokens = unknownAfterCompaction ? null : usage ? usage.tokens : (state.context.tokens ?? null);
	const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? state.context.window ?? 0;
	const percent = unknownAfterCompaction ? null : usage ? usage.percent : (state.context.percent ?? null);
	if (state.context.tokens === tokens && state.context.window === window && state.context.percent === percent) return false;
	state.context.tokens = tokens;
	state.context.window = window;
	state.context.percent = percent;
	touch(state);
	return true;
}

export function refreshModel(state: GlanceState, ctx: ExtensionContext, config: GlanceConfig, thinkingLevel: string): boolean {
	const id = ctx.model?.id;
	const provider = ctx.model?.provider;
	const displayName = shortenModel(ctx.model?.id, config.model.customNames);
	const window = ctx.model?.contextWindow ?? state.context.window;
	if (
		state.model.id === id &&
		state.model.provider === provider &&
		state.model.displayName === displayName &&
		state.model.thinking === thinkingLevel &&
		state.context.window === window
	) {
		return false;
	}
	state.model.id = id;
	state.model.provider = provider;
	state.model.displayName = displayName;
	state.model.thinking = thinkingLevel;
	state.context.window = window;
	touch(state);
	return true;
}
