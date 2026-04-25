import { formatCost, formatPercent, formatTokens, stripControls } from "./format.js";
import type { SegmentDefinition, SegmentRenderContext, SegmentRenderResult } from "./types.js";

function withIcon(ctx: SegmentRenderContext, segment: SegmentDefinition, value: string): SegmentRenderResult {
	const icon = ctx.icons[segment.id];
	const prefix = icon ? `${icon} ` : "";
	const config = ctx.config.segments.find((s) => s.id === segment.id);
	return {
		id: segment.id,
		text: `${prefix}${value}`.trim(),
		priority: config?.priority ?? segment.defaultPriority,
	};
}

export const SEGMENTS: SegmentDefinition[] = [
	{
		id: "git.branch",
		label: "Git Branch",
		defaultPriority: 65,
		render(ctx) {
			if (!ctx.state.git.branch) return undefined;
			return withIcon(ctx, this, stripControls(ctx.state.git.branch));
		},
	},
	{
		id: "model",
		label: "Model",
		defaultPriority: 100,
		render(ctx) {
			let model = ctx.state.model.displayName || ctx.state.model.id || "no-model";
			if (ctx.showProvider && ctx.state.model.provider && ctx.widthMode === "full") {
				model = `${ctx.state.model.provider}/${model}`;
			}
			if (ctx.state.model.thinking && ctx.state.model.thinking !== "off" && ctx.widthMode !== "minimal") {
				model += ` ${ctx.state.model.thinking}`;
			}
			return withIcon(ctx, this, model);
		},
	},
	{
		id: "context",
		label: "Context",
		defaultPriority: 95,
		render(ctx) {
			const pct = formatPercent(ctx.state.context.percent);
			const tokens = formatTokens(ctx.state.context.tokens);
			const window = formatTokens(ctx.state.context.window);
			const value = ctx.widthMode === "full" ? `${pct} ${tokens}/${window}` : pct;
			return withIcon(ctx, this, value);
		},
	},
	{
		id: "tokens",
		label: "Tokens",
		defaultPriority: 55,
		render(ctx) {
			const usage = ctx.state.usage;
			const parts = [`↑${formatTokens(usage.input)}`, `↓${formatTokens(usage.output)}`];
			if (ctx.widthMode === "full") {
				if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
				if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
			}
			return withIcon(ctx, this, parts.join(" "));
		},
	},
	{
		id: "cost",
		label: "Cost",
		defaultPriority: 35,
		render(ctx) {
			return withIcon(ctx, this, formatCost(ctx.state.usage.cost));
		},
	},
];

export const SEGMENT_BY_ID = new Map(SEGMENTS.map((segment) => [segment.id, segment]));
