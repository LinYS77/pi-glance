import type { SegmentFeature } from "./segment-feature.js";
import type { GlanceConfig, SegmentData, SegmentRenderContext } from "./types.js";

function onOff(value: boolean): string {
	return value ? "on" : "off";
}

function formatCost(cost: number): string {
	if (!Number.isFinite(cost) || cost <= 0) return "$0.000";
	if (cost < 0.001) return "<$0.001";
	if (cost < 1) return `$${cost.toFixed(3)}`;
	if (cost < 10) return `$${cost.toFixed(2)}`;
	return `$${cost.toFixed(1)}`;
}

function collectCost(ctx: SegmentRenderContext): SegmentData | undefined {
	if (ctx.config.cost.hideZero && (!Number.isFinite(ctx.state.usage.cost) || ctx.state.usage.cost <= 0)) return undefined;
	return {
		primary: formatCost(ctx.state.usage.cost),
	};
}

export const costSegmentFeature = {
	id: "cost",
	label: "Cost",
	defaultEnabled: true,
	settings: [
		{
			id: "cost.hideZero",
			label: "Hide zero",
			hint: "Hide until cost is non-zero.",
			kind: "toggle",
			value: (config: GlanceConfig) => onOff(config.cost.hideZero),
			mutate: (config: GlanceConfig) => {
				config.cost.hideZero = !config.cost.hideZero;
			},
		},
		{
			id: "cost.display",
			label: "Display",
			hint: "Compact session cost.",
			kind: "info",
			value: () => "compact USD",
		},
	],
	collect: collectCost,
} as const satisfies SegmentFeature;
