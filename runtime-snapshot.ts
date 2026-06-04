import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { UsageTotals } from "./types.js";

export interface StateModelInputs {
	id?: string;
	provider?: string;
	contextWindow?: number;
}

export interface StateContextUsageInputs {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface StateInputs {
	cwd: string;
	model?: StateModelInputs;
	thinkingLevel: string;
	contextUsage?: StateContextUsageInputs;
	usage: UsageTotals;
	unknownContextAfterLatestCompaction: boolean;
}

interface StateMessageCostInputs {
	total?: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

interface StateMessageUsageInputs {
	totalTokens?: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: StateMessageCostInputs;
}

interface StateMessageInputs {
	role?: string;
	stopReason?: string;
	usage?: StateMessageUsageInputs;
}

export interface StateSessionEntry {
	type?: string;
	message?: StateMessageInputs;
}

function usageCost(message: StateMessageInputs): number {
	const cost = message.usage?.cost;
	if (!cost) return 0;
	if (Number.isFinite(cost.total)) return cost.total ?? 0;
	return (cost.input ?? 0) + (cost.output ?? 0) + (cost.cacheRead ?? 0) + (cost.cacheWrite ?? 0);
}

export function usageTotalsFromEntries(entries: readonly StateSessionEntry[]): UsageTotals {
	const usage: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
		const message = entry.message;
		usage.input += message.usage?.input ?? 0;
		usage.output += message.usage?.output ?? 0;
		usage.cacheRead += message.usage?.cacheRead ?? 0;
		usage.cacheWrite += message.usage?.cacheWrite ?? 0;
		usage.cost += usageCost(message);
	}
	return usage;
}

function assistantContextTokens(message: StateMessageInputs): number {
	const usage = message.usage;
	if (!usage) return 0;
	if (Number.isFinite(usage.totalTokens)) return usage.totalTokens ?? 0;
	return (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

export function hasUnknownContextAfterLatestCompaction(branch: readonly StateSessionEntry[]): boolean {
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
		if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
		const message = entry.message;
		if (message.stopReason === "aborted" || message.stopReason === "error") return true;
		return assistantContextTokens(message) <= 0;
	}

	return true;
}

export function stateInputsFromContext(ctx: ExtensionContext, thinkingLevel: string): StateInputs {
	const cwd = ctx.sessionManager.getCwd() || ctx.cwd;
	const contextUsage = ctx.getContextUsage();
	return {
		cwd,
		model: ctx.model
			? {
					id: ctx.model.id,
					provider: ctx.model.provider,
					contextWindow: ctx.model.contextWindow,
				}
			: undefined,
		thinkingLevel,
		contextUsage: contextUsage
			? {
					tokens: contextUsage.tokens,
					contextWindow: contextUsage.contextWindow,
					percent: contextUsage.percent,
				}
			: undefined,
		usage: usageTotalsFromEntries(ctx.sessionManager.getEntries()),
		unknownContextAfterLatestCompaction: hasUnknownContextAfterLatestCompaction(ctx.sessionManager.getBranch()),
	};
}
