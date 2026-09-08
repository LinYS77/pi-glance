import type { ResolvedGlanceStyles, TextStyler } from "../theme/adapter.js";
import { safeSurfaceWidth } from "./layout.js";
import { createTextSweep, sweepMotion } from "./sweep.js";

// Terminal cells are roughly twice as tall as they are wide.
const ROW_DISTANCE = 2;

export interface PerimeterGap {
	column: number;
	width: number;
}

export function perimeterSweepProfile(width: number, bodyRows: number, elapsedMs: number, topGap?: PerimeterGap, speed?: number, bottomGap?: PerimeterGap) {
	const horizontal = Math.max(0, safeSurfaceWidth(width) - 1);
	const rows = Number.isFinite(bodyRows) ? Math.max(0, Math.floor(bodyRows)) : 0;
	const vertical = (rows + 1) * ROW_DISTANCE;
	const gapWidth = Math.min(horizontal, safeSurfaceWidth(topGap?.width ?? 0));
	const gapColumn = Math.min(horizontal - gapWidth, safeSurfaceWidth(topGap?.column ?? horizontal));
	const bottomGapWidth = Math.min(horizontal, safeSurfaceWidth(bottomGap?.width ?? 0));
	const bottomGapColumn = Math.min(horizontal - bottomGapWidth, safeSurfaceWidth(bottomGap?.column ?? 0));
	const length = 2 * (horizontal + vertical) - gapWidth - bottomGapWidth;
	const radius = Math.min(length / 4, Math.max(9, Math.min(28, horizontal * 0.16)));
	const { position, periodMs } = sweepMotion(length, elapsedMs, speed);
	return { horizontal, vertical, gapWidth, gapColumn, bottomGapWidth, bottomGapColumn, length, radius, periodMs, center: position };
}

/** One clockwise path, starting at the top-left corner. Margins are not part of it. */
export function createPerimeterSweep(width: number, bodyRows: number, elapsedMs: number, styles: ResolvedGlanceStyles, topGap?: PerimeterGap, speed?: number, bottomGap?: PerimeterGap) {
	const profile = perimeterSweepProfile(width, bodyRows, elapsedMs, topGap, speed, bottomGap);
	const paint = createTextSweep(profile, styles);
	return (text: string, style: TextStyler, column: number, row: number): string => {
		if (width < 2) return style(text);
		if (row === 0) {
			// Status text keeps its own colors and takes no time on the visible path.
			const skipped = column >= profile.gapColumn + profile.gapWidth ? profile.gapWidth : 0;
			return paint(text, style, column - skipped - 0.5);
		}
		if (row === bodyRows + 1) {
			const skipped = column <= profile.bottomGapColumn ? profile.bottomGapWidth : 0;
			return paint(text, style, 2 * profile.horizontal + profile.vertical - profile.gapWidth - skipped - column + 0.5, -1);
		}
		const position = column === 0
			? profile.length - row * ROW_DISTANCE
			: profile.horizontal - profile.gapWidth + row * ROW_DISTANCE;
		return paint(text, style, position - 0.5);
	};
}

export type PerimeterSweep = ReturnType<typeof createPerimeterSweep>;
