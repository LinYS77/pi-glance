import { choiceSetting } from "../config/settings.js";
import type { SegmentFeature } from "./feature.js";
import { formatPercent, formatTokens } from "./display-primitives.js";
import type { SegmentData, SegmentRenderContext } from "../types.js";

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
	if (contextIsUnknown(ctx)) return ratio;
	return `${pct} ${ratio}`;
}

function contextCompactValue(ctx: SegmentRenderContext): string {
	if (ctx.config.context.display === "tokens") return contextTokenRatio(ctx);
	return formatPercent(ctx.state.context.percent);
}

function collectContext(ctx: SegmentRenderContext): SegmentData | undefined {
	if (ctx.config.context.unknown === "hide" && contextIsUnknown(ctx)) return undefined;
	const primary =
		ctx.config.context.display === "tokens" ? contextTokenRatio(ctx) : formatPercent(ctx.state.context.percent);
	const secondary = ctx.config.context.display === "percent+tokens" ? contextTokenRatio(ctx) : undefined;
	const compact = contextCompactValue(ctx);
	const percent = ctx.state.context.percent;
	return {
		tone: percent !== null && percent >= 90 ? "error" : percent !== null && percent >= 75 ? "warning" : "normal",
		primary,
		secondary,
		display: {
			full: contextDisplayValue(ctx),
			compact,
			minimal: compact,
		},
	};
}

export const contextSegmentFeature = {
	id: "context",
	label: "Context",
	defaultEnabled: true,
	settings: [
		choiceSetting(
			"context.display",
			"Show",
			"Choose how context usage appears.",
			[
				{ value: "percent+tokens", label: "Percentage + tokens" },
				{ value: "percent", label: "Percentage" },
				{ value: "tokens", label: "Tokens" },
			],
			(c) => c.context.display,
			(c, v) => {
				c.context.display = v;
			},
		),
		choiceSetting(
			"context.unknown",
			"When unavailable",
			"What to show when Pi cannot report context usage.",
			[
				{ value: "show", label: "Show ?" },
				{ value: "hide", label: "Hide" },
			],
			(c) => c.context.unknown,
			(c, v) => {
				c.context.unknown = v;
			},
		),
	],
	collect: collectContext,
} as const satisfies SegmentFeature;
