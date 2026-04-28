import { formatCost, formatPercent, formatTokens, stripControls } from "./format.js";
import type { SegmentData, SegmentDefinition, SegmentRenderContext, SegmentRenderResult } from "./types.js";

function configuredPriority(ctx: SegmentRenderContext, segment: SegmentDefinition): number {
	const config = ctx.config.segments.find((s) => s.id === segment.id);
	return config?.priority ?? segment.defaultPriority;
}

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
		data,
		text: `${prefix}${value}`.trim(),
		priority: configuredPriority(ctx, segment),
	};
}

const SEGMENTS: SegmentDefinition[] = [
	{
		id: "git.branch",
		label: "Git Branch",
		defaultPriority: 65,
		collect(ctx) {
			const branch = ctx.state.git.branch ? stripControls(ctx.state.git.branch) : "";
			if (!branch) return undefined;
			return {
				primary: branch,
				parts: [{ text: branch, kind: "primary" }],
				metadata: {
					branch,
					repo: true,
				},
			};
		},
	},
	{
		id: "model",
		label: "Model",
		defaultPriority: 100,
		collect(ctx) {
			let model = ctx.state.model.displayName || ctx.state.model.id || "no-model";
			if (ctx.showProvider && ctx.state.model.provider && ctx.widthMode === "full") {
				model = `${ctx.state.model.provider}/${model}`;
			}
			const thinking = ctx.state.model.thinking && ctx.state.model.thinking !== "off" ? ctx.state.model.thinking : "";
			return {
				primary: model,
				secondary: thinking || undefined,
				parts: [
					{ text: model, kind: "primary" },
					...(thinking ? [{ text: thinking, kind: "detail" as const, tone: "muted" as const }] : []),
				],
				display: {
					full: thinking ? `${model} ${thinking}` : model,
					compact: thinking ? `${model} ${thinking}` : model,
					minimal: model,
				},
				metadata: {
					id: ctx.state.model.id ?? null,
					provider: ctx.state.model.provider ?? null,
					displayName: ctx.state.model.displayName ?? null,
					thinking: ctx.state.model.thinking || null,
				},
			};
		},
	},
	{
		id: "context",
		label: "Context",
		defaultPriority: 95,
		collect(ctx) {
			const pct = formatPercent(ctx.state.context.percent);
			const tokens = formatTokens(ctx.state.context.tokens);
			const window = formatTokens(ctx.state.context.window);
			return {
				primary: pct,
				secondary: `${tokens}/${window}`,
				parts: [
					{ text: pct, kind: "primary" },
					{ text: `${tokens}/${window}`, kind: "detail", tone: "muted" },
				],
				display: {
					full: `${pct} ${tokens}/${window}`,
					compact: pct,
					minimal: pct,
				},
				metadata: {
					known: ctx.state.context.percent !== null && ctx.state.context.tokens !== null,
					percent: ctx.state.context.percent,
					tokens: ctx.state.context.tokens,
					window: ctx.state.context.window,
				},
			};
		},
	},
	{
		id: "tokens",
		label: "Tokens",
		defaultPriority: 55,
		collect(ctx) {
			const usage = ctx.state.usage;
			const primary = `↑${formatTokens(usage.input)} ↓${formatTokens(usage.output)}`;
			const cacheParts = [];
			if (usage.cacheRead) cacheParts.push(`R${formatTokens(usage.cacheRead)}`);
			if (usage.cacheWrite) cacheParts.push(`W${formatTokens(usage.cacheWrite)}`);
			return {
				primary,
				secondary: cacheParts.join(" ") || undefined,
				parts: [
					{ text: `↑${formatTokens(usage.input)}`, kind: "metric" },
					{ text: `↓${formatTokens(usage.output)}`, kind: "metric" },
					...cacheParts.map((part) => ({ text: part, kind: "detail" as const, tone: "muted" as const })),
				],
				display: {
					full: [primary, ...cacheParts].join(" "),
					compact: primary,
					minimal: primary,
				},
				metadata: {
					input: usage.input,
					output: usage.output,
					cacheRead: usage.cacheRead,
					cacheWrite: usage.cacheWrite,
					total: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
				},
			};
		},
	},
	{
		id: "cost",
		label: "Cost",
		defaultPriority: 35,
		collect(ctx) {
			const cost = formatCost(ctx.state.usage.cost);
			return {
				primary: cost,
				parts: [{ text: cost, kind: "primary" }],
				metadata: {
					usd: ctx.state.usage.cost,
				},
			};
		},
	},
];

export function renderSegment(ctx: SegmentRenderContext, segment: SegmentDefinition): SegmentRenderResult | undefined {
	const data = segment.collect(ctx);
	return data ? renderCollectedSegment(ctx, segment, data) : undefined;
}

export const SEGMENT_BY_ID = new Map(SEGMENTS.map((segment) => [segment.id, segment]));
