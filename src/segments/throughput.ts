import { THROUGHPUT_PRECISION_DESCRIPTOR } from "../config/schema.js";
import { choiceSetting } from "../config/settings.js";
import type { SegmentFeature } from "./feature.js";
import type { SegmentData, SegmentRenderContext, ThroughputPrecision, ModelSpeedMeasurement } from "../types.js";

function fixedPrecision(value: number, precision: 0 | 1): string {
	return precision === 0 ? `${Math.round(value)}` : value.toFixed(1);
}

function formatScaledThroughputRate(rate: number, precision: 0 | 1): string {
	const abs = Math.abs(rate);
	if (abs < 1000) return fixedPrecision(rate, precision);
	if (abs < 1_000_000) return `${fixedPrecision(rate / 1000, precision)}k`;
	return `${fixedPrecision(rate / 1_000_000, precision)}M`;
}

function formatThroughputRate(rate: number, precision: ThroughputPrecision): string {
	if (precision !== "auto") return formatScaledThroughputRate(rate, precision);
	if (rate < 10) return rate.toFixed(1);
	if (rate < 1000) return `${Math.round(rate)}`;
	const abs = Math.abs(rate);
	if (abs < 10_000) return `${(rate / 1000).toFixed(1)}k`;
	if (abs < 1_000_000) return `${Math.round(rate / 1000)}k`;
	if (abs < 10_000_000) return `${(rate / 1_000_000).toFixed(1)}M`;
	return `${Math.round(rate / 1_000_000)}M`;
}

function validThroughput(turn: ModelSpeedMeasurement | null | undefined): turn is ModelSpeedMeasurement {
	const rate = turn?.tokensPerSecond;
	return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

function collectThroughput(ctx: SegmentRenderContext): SegmentData | undefined {
	const currentRun = ctx.state.throughput.currentRun;
	const lastRun = ctx.state.throughput.lastRun;
	const turn = validThroughput(currentRun) ? currentRun : validThroughput(lastRun) ? lastRun : undefined;
	if (!turn) {
		return {
			primary: "? tok/s",
			display: {
				full: "? tok/s",
				compact: "?/s",
				minimal: "?/s",
			},
		};
	}
	const marker = turn === currentRun ? "~" : "";
	const formatted = `${marker}${formatThroughputRate(turn.tokensPerSecond, ctx.config.throughput.precision)}`;
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
	label: "Model speed",
	iconSpacing: { nerd: 2 },
	defaultEnabled: true,
	settings: [
		choiceSetting(
			"throughput.precision",
			"Decimal places",
			"Output tokens per second, excluding reasoning and tool waits.",
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
