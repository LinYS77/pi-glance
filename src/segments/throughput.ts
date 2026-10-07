import { THROUGHPUT_PRECISION_DESCRIPTOR } from "../config/schema.js";
import { choiceSetting } from "../config/settings.js";
import type { SegmentFeature } from "./feature.js";
import type { SegmentData, SegmentRenderContext, ThroughputPrecision, ModelSpeedMeasurement } from "../types.js";

function formatThroughputRate(rate: number, precision: ThroughputPrecision): string {
	const scale = rate < 1_000 ? 1 : rate < 1_000_000 ? 1_000 : 1_000_000;
	const scaled = rate / scale;
	const decimals = precision === "auto" ? (scaled < 10 ? 1 : 0) : precision;
	const value = decimals === 0 ? `${Math.round(scaled)}` : scaled.toFixed(1);
	return `${value}${scale === 1 ? "" : scale === 1_000 ? "k" : "M"}`;
}

function validThroughput(turn: ModelSpeedMeasurement | null | undefined): turn is ModelSpeedMeasurement {
	const rate = turn?.tokensPerSecond;
	return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

function collectThroughput(ctx: SegmentRenderContext): SegmentData {
	const { currentRun, lastRun } = ctx.state.throughput;
	const turn = validThroughput(currentRun) ? currentRun : validThroughput(lastRun) ? lastRun : undefined;
	const formatted = turn
		? `${turn === currentRun ? "~" : ""}${formatThroughputRate(turn.tokensPerSecond, ctx.config.throughput.precision)}`
		: "?";
	return {
		primary: `${formatted} tok/s`,
		display: {
			full: `${formatted} tok/s`,
			compact: `${formatted}/s`,
			minimal: `${formatted}/s`,
		},
	};
}

export const throughputSegmentFeature = {
	id: "throughput",
	label: "Output throughput",
	iconSpacing: { nerd: 2 },
	defaultEnabled: true,
	settings: [
		choiceSetting(
			"throughput.precision",
			"Decimal places",
			"All reported output (including reasoning) per full request second; not raw decode speed.",
			THROUGHPUT_PRECISION_DESCRIPTOR.values.map((value) => ({
				value,
				label: value === "auto" ? "Automatic" : value === 1 ? "1 decimal" : "Whole numbers",
			})),
			(c) => c.throughput.precision,
			(c, v) => {
				c.throughput.precision = v;
			},
		),
	],
	collect: collectThroughput,
} as const satisfies SegmentFeature;
