import { TOKENS_CACHE_MODE_VALUES, TOKENS_DISPLAY_MODE_VALUES, nextOption } from "../config/options.js";
import { formatTokens } from "./display-primitives.js";
import type { SegmentFeature } from "./feature.js";
import type { GlanceConfig, SegmentData, SegmentRenderContext, UsageTotals } from "../types.js";

const TOKENS_DISPLAY_LABELS: Record<GlanceConfig["tokens"]["display"], string> = {
	"input-output": "input / output",
	total: "total",
};

const TOKENS_CACHE_LABELS: Record<GlanceConfig["tokens"]["cache"], string> = {
	rate: "rate",
	"read-write": "read/write",
	hide: "hide",
};

const TOKEN_CACHE_RATE_NERD_ICON = "󰑐"; // nf-md-refresh (U+F0450)

function tokensDisplayLabel(mode: GlanceConfig["tokens"]["display"]): string {
	return TOKENS_DISPLAY_LABELS[mode];
}

function tokensCacheLabel(mode: GlanceConfig["tokens"]["cache"]): string {
	return TOKENS_CACHE_LABELS[mode];
}

function shouldShowTokenCache(ctx: SegmentRenderContext): boolean {
	return ctx.config.tokens.cache !== "hide";
}

function sessionCacheHitPercent(usage: UsageTotals): number | undefined {
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	return promptTokens > 0 ? Math.round((usage.cacheRead / promptTokens) * 100) : undefined;
}

function tokenCacheParts(ctx: SegmentRenderContext, hitRate: number | undefined): string[] {
	if (!shouldShowTokenCache(ctx)) return [];
	const usage = ctx.state.usage;
	const parts: string[] = [];
	if (ctx.config.tokens.cache === "rate") {
		if (hitRate !== undefined) {
			const icon = ctx.config.icons === "nerd" ? TOKEN_CACHE_RATE_NERD_ICON : "";
			parts.push(`${icon}${hitRate}%`);
		}
	} else {
		// Read/write mode shows the aggregate cache token amounts directly.
		if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
		if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	}
	return parts;
}

function tokenPrimary(ctx: SegmentRenderContext): string {
	const usage = ctx.state.usage;
	if (ctx.config.tokens.display === "total") return `total ${formatTokens(usage.input + usage.output)}`;
	return `↑${formatTokens(usage.input)} ↓${formatTokens(usage.output)}`;
}

function tokenMinimal(ctx: SegmentRenderContext): string {
	return formatTokens(ctx.state.usage.input + ctx.state.usage.output);
}

function collectTokens(ctx: SegmentRenderContext): SegmentData | undefined {
	const primary = tokenPrimary(ctx);
	const hitRate = ctx.config.tokens.cache === "rate" ? sessionCacheHitPercent(ctx.state.usage) : undefined;
	const cacheParts = tokenCacheParts(ctx, hitRate);
	const foldedRate = hitRate !== undefined ? `${hitRate}%` : undefined;
	return {
		primary,
		secondary: cacheParts.join(" ") || undefined,
		display: {
			full: [primary, ...cacheParts].join(" "),
			compact: foldedRate ?? primary,
			minimal: foldedRate ?? tokenMinimal(ctx),
		},
	};
}

export const tokensSegmentFeature = {
	id: "tokens",
	label: "Tokens",
	defaultEnabled: false,
	settings: [
		{
			id: "tokens.display",
			label: "Display",
			hint: "Choose input/output or total.",
			kind: "cycle",
			value: (config: GlanceConfig) => tokensDisplayLabel(config.tokens.display),
			mutate: (config: GlanceConfig) => {
				config.tokens.display = nextOption(config.tokens.display, TOKENS_DISPLAY_MODE_VALUES);
			},
		},
		{
			id: "tokens.cache",
			label: "Cache",
			hint: "Cache rate, read/write counts, or hidden.",
			kind: "cycle",
			value: (config: GlanceConfig) => tokensCacheLabel(config.tokens.cache),
			mutate: (config: GlanceConfig) => {
				config.tokens.cache = nextOption(config.tokens.cache, TOKENS_CACHE_MODE_VALUES);
			},
		},
	],
	collect: collectTokens,
} as const satisfies SegmentFeature;
