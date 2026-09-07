import type { ResolvedGlanceStyles } from "../theme/adapter.js";
import { createTextSweep, sweepMotion } from "./sweep.js";

export function sweepProfile(width: number, elapsedMs: number, speed?: number): { center: number; radius: number; periodMs: number } {
	const columns = Number.isFinite(width) ? Math.max(0, width) : 0;
	const radius = Math.max(9, Math.min(28, columns * 0.16));
	const { position, periodMs } = sweepMotion(columns + radius * 2, elapsedMs, speed);
	return { radius, periodMs, center: position - radius };
}

/** A broad, feathered beam across the path and its connecting line only. */
export function createTopEdgeSweep(width: number, elapsedMs: number, styles: ResolvedGlanceStyles, speed?: number) {
	return createTextSweep(sweepProfile(width, elapsedMs, speed), styles);
}
