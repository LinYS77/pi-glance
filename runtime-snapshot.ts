import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { UsageTotals } from "./types.js";

export interface StateModelInputs {
	id?: string;
	name?: string;
	provider?: string;
	contextWindow?: number;
}

export interface StateContextUsageInputs {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
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

export interface StateInputs extends StateLifecycleInputs {
	usage: UsageTotals;
}

interface StateMessageCostInputs {
	total?: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

export interface StateUsageInputs {
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
	responseId?: unknown;
	toolCallId?: unknown;
	usage?: StateUsageInputs;
}

export interface StateSessionEntry {
	type?: string;
	id?: unknown;
	message?: StateMessageInputs;
	usage?: StateUsageInputs;
}

function emptyUsageTotals(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function usageCost(usage: StateUsageInputs | undefined): number {
	const cost = usage?.cost;
	if (!cost) return 0;
	if (Number.isFinite(cost.total)) return cost.total ?? 0;
	return (cost.input ?? 0) + (cost.output ?? 0) + (cost.cacheRead ?? 0) + (cost.cacheWrite ?? 0);
}

export function usageTotalsFromUsage(usage: StateUsageInputs | undefined): UsageTotals {
	return {
		input: usage?.input ?? 0,
		output: usage?.output ?? 0,
		cacheRead: usage?.cacheRead ?? 0,
		cacheWrite: usage?.cacheWrite ?? 0,
		cost: usageCost(usage),
	};
}

export function usageTotalsFromMessage(message: StateMessageInputs): UsageTotals {
	if (message.role !== "assistant" && message.role !== "toolResult") return emptyUsageTotals();
	return usageTotalsFromUsage(message.usage);
}

export function usageTotalsFromEntry(entry: StateSessionEntry): UsageTotals {
	if (entry.type === "message" && entry.message) return usageTotalsFromMessage(entry.message);
	if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) return usageTotalsFromUsage(entry.usage);
	return emptyUsageTotals();
}

export function usageTotalsFromEntries(entries: readonly StateSessionEntry[]): UsageTotals {
	const usage = emptyUsageTotals();
	for (const entry of entries) {
		const delta = usageTotalsFromEntry(entry);
		usage.input += delta.input;
		usage.output += delta.output;
		usage.cacheRead += delta.cacheRead;
		usage.cacheWrite += delta.cacheWrite;
		usage.cost += delta.cost;
	}
	return usage;
}

function availableProviderCountFromContext(ctx: ExtensionContext): number {
	const scopedModels = ctx.scopedModels ?? [];
	const availableModels = scopedModels.length > 0 ? scopedModels.map((entry) => entry.model) : ctx.modelRegistry.getAvailable();
	const providers = new Set<string>();
	for (const model of availableModels) {
		if (typeof model.provider === "string" && model.provider) providers.add(model.provider);
	}
	return Math.max(1, providers.size);
}

function modelInputsFromContext(ctx: ExtensionContext): StateModelInputs | undefined {
	const model = ctx.model;
	if (!model) return undefined;
	const name = model.name?.trim();
	return {
		id: model.id,
		...(name ? { name } : {}),
		provider: model.provider,
		contextWindow: model.contextWindow,
	};
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
	};
}
