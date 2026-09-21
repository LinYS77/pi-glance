import type { ThroughputPrecision } from "../types.js";

export interface NumericSettingSpec {
	readonly defaultValue: number;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly precision: number;
	normalize(value: unknown): number;
}

function numericSetting(defaultValue: number, min: number, max: number, step: number, precision: number): NumericSettingSpec {
	return {
		defaultValue, min, max, step, precision,
		normalize: value => typeof value === "number" && Number.isFinite(value)
			? Number(Math.max(min, Math.min(max, value)).toFixed(precision)) : defaultValue,
	};
}

export const SUMMARY_SPEED = numericSetting(0.5, 0.25, 2, 0.05, 2);
export const RETRY_BLINK = numericSetting(0.5, 0.25, 2, 0.25, 2);

export const WORKING_SPEED = {
	step: 1,
	precision: 0,
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
