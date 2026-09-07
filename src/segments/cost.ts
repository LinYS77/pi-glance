import { formatCost } from "./display-primitives.js";
import { toggleSetting, type SegmentFeature } from "./feature.js";
import type { SegmentData, SegmentRenderContext } from "../types.js";

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
		toggleSetting("cost.hideZero", "Hide zero cost", "Hide the session cost until it is greater than zero.", c => c.cost.hideZero, (c, v) => { c.cost.hideZero = v; }),
	],
	collect: collectCost,
} as const satisfies SegmentFeature;
