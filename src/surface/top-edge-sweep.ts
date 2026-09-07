import type { ResolvedGlanceStyles } from "../theme/adapter.js";
import { createTextSweep, sweepMotion } from "./sweep.js";

export function sweepProfile(width: number, elapsedMs: number): { center: number; radius: number; periodMs: number } {
	const columns = Number.isFinite(width) ? Math.max(0, width) : 0;
	const radius = Math.max(9, Math.min(28, columns * 0.16));
	const { position, periodMs } = sweepMotion(columns + radius * 2, elapsedMs);
	return { radius, periodMs, center: position - radius };
}

/** A broad, feathered beam across the path and its connecting line only. */
export function createTopEdgeSweep(width: number, elapsedMs: number, styles: ResolvedGlanceStyles) {
	return createTextSweep(sweepProfile(width, elapsedMs), styles);
}
