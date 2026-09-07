import type { ThroughputPrecision } from "../types.js";

export const WORKING_SPEED = {
	defaultValue: 47,
	min: 10,
	max: 120,
	normalize(value: unknown): number {
		return typeof value === "number" && Number.isFinite(value)
			? Math.max(this.min, Math.min(this.max, Math.round(value)))
			: this.defaultValue;
	},
} as const;

export const THROUGHPUT_PRECISION_DESCRIPTOR = {
	defaultValue: "auto" as const,
	values: ["auto", 1, 0] as const satisfies readonly ThroughputPrecision[],
	normalize(value: unknown): ThroughputPrecision {
		return value === "auto" || value === 1 || value === 0 ? value : "auto";
	},
} as const;
