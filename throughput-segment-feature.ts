import { THROUGHPUT_PRECISION_VALUES } from "./config-options.js";
import type { SegmentFeature } from "./segment-feature.js";
import type { GlanceConfig, SegmentData, SegmentRenderContext, ThroughputPrecision, TurnThroughput } from "./types.js";

function throughputPrecisionLabel(precision: ThroughputPrecision): string {
	if (precision === 1) return "1 digit";
	if (precision === 0) return "0 digits";
	return "auto";
}

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

function validThroughput(turn: TurnThroughput | null | undefined): turn is TurnThroughput {
	const rate = turn?.tokensPerSecond;
	return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

function collectThroughput(ctx: SegmentRenderContext): SegmentData | undefined {
	const currentRun = ctx.state.throughput.currentRun;
	const lastTurn = ctx.state.throughput.lastTurn;
	const turn = validThroughput(currentRun) ? currentRun : validThroughput(lastTurn) ? lastTurn : undefined;
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
	label: "Reply speed",
	defaultEnabled: true,
	settings: [
		{
			id: "throughput.precision",
			label: "Precision",
			hint: "Controls Reply speed decimals. Output tokens / wall time; includes tools, waiting, network, and thinking; not a benchmark.",
			kind: "cycle",
			value: (config: GlanceConfig) => throughputPrecisionLabel(config.throughput.precision),
			mutate: (config: GlanceConfig) => {
				const index = THROUGHPUT_PRECISION_VALUES.indexOf(config.throughput.precision);
				config.throughput.precision = THROUGHPUT_PRECISION_VALUES[index + 1] ?? THROUGHPUT_PRECISION_VALUES[0]!;
			},
		},
	],
	collect: collectThroughput,
} as const satisfies SegmentFeature;
