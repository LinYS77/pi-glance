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
	availableProviderCount: number;
	unknownContextAfterLatestCompaction: boolean;
}

export interface StateThinkingInputs {
	model?: StateModelInputs;
	thinkingLevel: string;
	availableProviderCount: number;
}

export interface StateLifecycleInputs extends StateThinkingInputs {
	cwd: string;
	contextUsage?: StateContextUsageInputs;
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

export interface StateMessageInputs {
	role?: string;
	stopReason?: string;
	usage?: StateMessageUsageInputs;
}

interface ModelRegistryLike {
	getAvailable?(): readonly { provider?: unknown }[];
}

interface ProviderContext {
	modelRegistry?: ModelRegistryLike;
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

export function usageTotalsFromAssistantMessage(message: StateMessageInputs): UsageTotals {
	if (message.role !== "assistant") return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	return {
		input: message.usage?.input ?? 0,
		output: message.usage?.output ?? 0,
		cacheRead: message.usage?.cacheRead ?? 0,
		cacheWrite: message.usage?.cacheWrite ?? 0,
		cost: usageCost(message),
	};
}

export function usageTotalsFromEntries(entries: readonly StateSessionEntry[]): UsageTotals {
	const usage: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message) continue;
		const delta = usageTotalsFromAssistantMessage(entry.message);
		usage.input += delta.input;
		usage.output += delta.output;
		usage.cacheRead += delta.cacheRead;
		usage.cacheWrite += delta.cacheWrite;
		usage.cost += delta.cost;
	}
	return usage;
}

function assistantContextTokens(message: StateMessageInputs): number {
	const usage = message.usage;
	if (!usage) return 0;
	if (Number.isFinite(usage.totalTokens)) return usage.totalTokens ?? 0;
	return (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

export function assistantMessageHasKnownContextUsage(message: StateMessageInputs): boolean {
	if (message.role !== "assistant") return false;
	if (message.stopReason === "aborted" || message.stopReason === "error") return false;
	return assistantContextTokens(message) > 0;
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

function availableProviderCountFromContext(ctx: ExtensionContext): number {
	const registry = (ctx as ExtensionContext & ProviderContext).modelRegistry;
	const availableModels = registry?.getAvailable?.() ?? [];
	const providers = new Set<string>();
	for (const model of availableModels) {
		if (typeof model.provider === "string" && model.provider) providers.add(model.provider);
	}
	return Math.max(1, providers.size);
}

function modelInputsFromContext(ctx: ExtensionContext): StateModelInputs | undefined {
	const model = ctx.model;
	return model
		? {
				id: model.id,
				provider: model.provider,
				contextWindow: model.contextWindow,
			}
		: undefined;
}

function contextUsageInputsFromContext(ctx: ExtensionContext): StateContextUsageInputs | undefined {
	const contextUsage = ctx.getContextUsage();
	return contextUsage
		? {
				tokens: contextUsage.tokens,
				contextWindow: contextUsage.contextWindow,
				percent: contextUsage.percent,
			}
		: undefined;
}

export function thinkingInputsFromContext(ctx: ExtensionContext, thinkingLevel: string): StateThinkingInputs {
	return {
		model: modelInputsFromContext(ctx),
		thinkingLevel,
		availableProviderCount: availableProviderCountFromContext(ctx),
	};
}

export function lifecycleInputsFromContext(ctx: ExtensionContext, thinkingLevel: string): StateLifecycleInputs {
	return {
		cwd: ctx.sessionManager.getCwd() || ctx.cwd,
		...thinkingInputsFromContext(ctx, thinkingLevel),
		contextUsage: contextUsageInputsFromContext(ctx),
	};
}

export function stateInputsFromContext(ctx: ExtensionContext, thinkingLevel: string): StateInputs {
	return {
		...lifecycleInputsFromContext(ctx, thinkingLevel),
		usage: usageTotalsFromEntries(ctx.sessionManager.getEntries()),
		unknownContextAfterLatestCompaction: hasUnknownContextAfterLatestCompaction(ctx.sessionManager.getBranch()),
	};
}
