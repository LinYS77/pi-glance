import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { UsageTotals } from "../types.js";

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
	usage: Readonly<UsageTotals>;
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

export function contextUsageInputsFromContext(ctx: ExtensionContext): StateContextUsageInputs | undefined {
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

export function lifecycleInputsFromContext(
	ctx: ExtensionContext,
	thinkingLevel: string,
	readContextUsage: () => StateContextUsageInputs | undefined = () => contextUsageInputsFromContext(ctx),
): StateLifecycleInputs {
	return {
		cwd: ctx.sessionManager.getCwd() || ctx.cwd,
		...thinkingInputsFromContext(ctx, thinkingLevel),
		contextUsage: readContextUsage(),
	};
}
