import { formatCost, formatPercent, formatTokens } from "./format.js";
import type { SegmentData, SegmentDefinition, SegmentRenderContext, SegmentRenderResult } from "./types.js";

function displayForMode(data: SegmentData, widthMode: SegmentRenderContext["widthMode"]): string {
	if (widthMode === "minimal" && data.display?.minimal !== undefined) return data.display.minimal;
	if (widthMode === "compact" && data.display?.compact !== undefined) return data.display.compact;
	if (widthMode === "full" && data.display?.full !== undefined) return data.display.full;
	const secondary = data.secondary ? ` ${data.secondary}` : "";
	return `${data.primary}${secondary}`.trim();
}

function renderCollectedSegment(ctx: SegmentRenderContext, segment: SegmentDefinition, data: SegmentData): SegmentRenderResult {
	const icon = ctx.icons[segment.id];
	const value = displayForMode(data, ctx.widthMode);
	const prefix = icon ? `${icon} ` : "";
	return {
		id: segment.id,
		text: `${prefix}${value}`.trim(),
	};
}

function gitBranchLabel(ctx: SegmentRenderContext): string {
	const git = ctx.state.git;
	if (git.branch) {
		if (ctx.config.git.shaMode === "always" && git.sha) return `${git.branch} ${git.sha}`;
		return git.branch;
	}
	if (git.detached && git.sha && ctx.config.git.shaMode !== "off") return git.sha;
	return "HEAD";
}

function gitStatusMark(ctx: SegmentRenderContext): string {
	const status = ctx.state.git.status;
	if (status === "conflict") return ctx.config.icons === "nerd" ? "⚠" : "!";
	if (status === "dirty") return ctx.config.icons === "nerd" ? "●" : "*";
	return "";
}

function gitDetailParts(ctx: SegmentRenderContext): string[] {
	const git = ctx.state.git;
	const parts: string[] = [];
	const status = gitStatusMark(ctx);
	if (status && (ctx.config.git.showDirty || git.status === "conflict")) parts.push(status);
	if (ctx.config.git.showAheadBehind) {
		if (git.ahead > 0) parts.push(`↑${git.ahead}`);
		if (git.behind > 0) parts.push(`↓${git.behind}`);
	}
	return parts;
}

function contextTokenRatio(ctx: SegmentRenderContext): string {
	return `${formatTokens(ctx.state.context.tokens)}/${formatTokens(ctx.state.context.window)}`;
}

function contextIsUnknown(ctx: SegmentRenderContext): boolean {
	return ctx.state.context.percent === null && ctx.state.context.tokens === null;
}

function contextDisplayValue(ctx: SegmentRenderContext): string {
	const pct = formatPercent(ctx.state.context.percent);
	const ratio = contextTokenRatio(ctx);
	if (ctx.config.context.display === "percent") return pct;
	if (ctx.config.context.display === "tokens") return ratio;
	return `${pct} ${ratio}`;
}

function contextCompactValue(ctx: SegmentRenderContext): string {
	if (ctx.config.context.display === "tokens") return contextTokenRatio(ctx);
	return formatPercent(ctx.state.context.percent);
}

function shouldShowThinking(ctx: SegmentRenderContext, thinking: string): boolean {
	if (ctx.config.model.showThinking === "never") return false;
	if (ctx.config.model.showThinking === "always") return Boolean(thinking);
	return thinking !== "off" && ctx.widthMode !== "minimal";
}

function shouldShowTokenCache(ctx: SegmentRenderContext): boolean {
	if (ctx.config.tokens.cache === "hide") return false;
	if (ctx.config.tokens.cache === "show") return true;
	return ctx.widthMode === "full";
}

function tokenCacheParts(ctx: SegmentRenderContext): string[] {
	if (!shouldShowTokenCache(ctx)) return [];
	const usage = ctx.state.usage;
	const parts: string[] = [];
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	return parts;
}

function tokenPrimary(ctx: SegmentRenderContext): string {
	const usage = ctx.state.usage;
	if (ctx.config.tokens.display === "total") return `total ${formatTokens(usage.input + usage.output)}`;
	return `↑${formatTokens(usage.input)} ↓${formatTokens(usage.output)}`;
}

const SEGMENTS: SegmentDefinition[] = [
	{
		id: "git",
		label: "Git",
		collect(ctx) {
			const git = ctx.state.git;
			if (!git.repo) return undefined;
			const branch = gitBranchLabel(ctx);
			const parts = gitDetailParts(ctx);
			const secondary = parts.join(" ") || undefined;
			const minimalStatus = git.status === "conflict" || ctx.config.git.showDirty ? gitStatusMark(ctx) : "";
			return {
				primary: branch,
				secondary,
				display: {
					minimal: [branch, minimalStatus].filter(Boolean).join(" "),
				},
			};
		},
	},
	{
		id: "model",
		label: "Model",
		collect(ctx) {
			let model = ctx.state.model.displayName || ctx.state.model.id || "no-model";
			if (ctx.showProvider && ctx.state.model.provider) {
				model = `${ctx.state.model.provider}/${model}`;
			}
			const thinking = ctx.state.model.thinking || "off";
			const visibleThinking = shouldShowThinking(ctx, thinking) ? thinking : "";
			return {
				primary: model,
				secondary: visibleThinking || undefined,
				display: {
					full: visibleThinking ? `${model} ${visibleThinking}` : model,
					compact: visibleThinking ? `${model} ${visibleThinking}` : model,
					minimal: visibleThinking ? `${model} ${visibleThinking}` : model,
				},
			};
		},
	},
	{
		id: "context",
		label: "Context",
		collect(ctx) {
			if (ctx.config.context.unknown === "hide" && contextIsUnknown(ctx)) return undefined;
			const primary = ctx.config.context.display === "tokens" ? contextTokenRatio(ctx) : formatPercent(ctx.state.context.percent);
			const secondary = ctx.config.context.display === "percent+tokens" ? contextTokenRatio(ctx) : undefined;
			const compact = contextCompactValue(ctx);
			return {
				primary,
				secondary,
				display: {
					full: contextDisplayValue(ctx),
					compact,
					minimal: compact,
				},
			};
		},
	},
	{
		id: "tokens",
		label: "Tokens",
		collect(ctx) {
			const primary = tokenPrimary(ctx);
			const cacheParts = tokenCacheParts(ctx);
			return {
				primary,
				secondary: cacheParts.join(" ") || undefined,
				display: {
					full: [primary, ...cacheParts].join(" "),
					compact: [primary, ...cacheParts].join(" "),
					minimal: [primary, ...cacheParts].join(" "),
				},
			};
		},
	},
	{
		id: "cost",
		label: "Cost",
		collect(ctx) {
			if (ctx.config.cost.hideZero && (!Number.isFinite(ctx.state.usage.cost) || ctx.state.usage.cost <= 0)) return undefined;
			return {
				primary: formatCost(ctx.state.usage.cost),
			};
		},
	},
];

export function renderSegment(ctx: SegmentRenderContext, segment: SegmentDefinition): SegmentRenderResult | undefined {
	const data = segment.collect(ctx);
	return data ? renderCollectedSegment(ctx, segment, data) : undefined;
}

export const SEGMENT_BY_ID = new Map(SEGMENTS.map((segment) => [segment.id, segment]));
