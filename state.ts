import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { displayDirectory, shortenModel } from "./format.js";
import type { GlanceConfig, GlanceState, UsageTotals } from "./types.js";

export function createInitialState(ctx: ExtensionContext, config: GlanceConfig, thinkingLevel: string): GlanceState {
	const cwd = ctx.sessionManager.getCwd?.() || ctx.cwd;
	const state: GlanceState = {
		workspace: {
			name: displayDirectory(cwd),
			path: cwd,
		},
		git: {
			branch: null,
		},
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

export function touch(state: GlanceState): void {
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

export function refreshWorkspace(state: GlanceState, ctx: ExtensionContext): boolean {
	const cwd = ctx.sessionManager.getCwd?.() || ctx.cwd;
	if (state.workspace.path === cwd) return false;
	state.workspace = {
		name: displayDirectory(cwd),
		path: cwd,
	};
	touch(state);
	return true;
}

export function refreshContextUsage(state: GlanceState, ctx: ExtensionContext): boolean {
	const usage = ctx.getContextUsage();
	const tokens = usage?.tokens ?? state.context.tokens ?? null;
	const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? state.context.window ?? 0;
	const percent = usage?.percent ?? state.context.percent ?? null;
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
