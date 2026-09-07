import { visibleWidth } from "@earendil-works/pi-tui";
import type { ResolvedGlanceStyles, TextStyler } from "../theme/adapter.js";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const SINGLE_CELL_TEXT = /^[\x20-\x7e─]*$/;
const TEXT_CACHE_LIMIT = 32;
const MAX_CACHED_TEXT_LENGTH = 1024;
const SWEEP_COLUMNS_PER_SECOND = 47;

/** Both paths use one travel speed; a longer route gets a longer cycle. */
export function sweepMotion(length: number, elapsedMs: number): { position: number; periodMs: number } {
	const distance = Number.isFinite(length) ? Math.max(0, length) : 0;
	const periodMs = distance / SWEEP_COLUMNS_PER_SECOND * 1000;
	const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
	return { periodMs, position: periodMs > 0 ? (elapsed % periodMs) / 1000 * SWEEP_COLUMNS_PER_SECOND : 0 };
}

interface MeasuredText {
	offsets: number[];
	centers: number[];
}

const measuredTexts = new Map<string, MeasuredText>();

function measureText(text: string): MeasuredText {
	const cached = measuredTexts.get(text);
	if (cached) {
		measuredTexts.delete(text);
		measuredTexts.set(text, cached);
		return cached;
	}
	const offsets = [0], centers: number[] = [];
	let column = 0;
	for (const { segment, index } of graphemes.segment(text)) {
		const width = visibleWidth(segment);
		centers.push(column + width / 2);
		column += width;
		offsets.push(index + segment.length);
	}
	const measured = { offsets, centers };
	if (text.length <= MAX_CACHED_TEXT_LENGTH) {
		if (measuredTexts.size >= TEXT_CACHE_LIMIT) measuredTexts.delete(measuredTexts.keys().next().value!);
		measuredTexts.set(text, measured);
	}
	return measured;
}

function lowerBound(values: readonly number[], target: number): number {
	let low = 0, high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (values[middle]! < target) low = middle + 1;
		else high = middle;
	}
	return low;
}

export interface SweepProfile {
	center: number;
	radius: number;
	/** Omit for an open sweep; otherwise distance wraps at this length. */
	length?: number;
}

/** Shades plain text in path coordinates, keeping unlit runs and graphemes intact. */
export function createTextSweep({ center, radius, length: loopLength }: SweepProfile, styles: ResolvedGlanceStyles) {
	const centers = loopLength ? [center - loopLength, center, center + loopLength] : [center];
	return (text: string, style: TextStyler, column: number, direction: 1 | -1 = 1): string => {
		if (!styles.highlight || !Number.isFinite(column)) return style(text);
		// ASCII paths and box-drawing lines need neither segmentation nor width lookups.
		const measured = SINGLE_CELL_TEXT.test(text) ? undefined : measureText(text);
		const length = measured?.centers.length ?? text.length;
		const ranges: Array<[number, number]> = [];
		for (const beamCenter of centers) {
			const localCenter = direction * (beamCenter - column);
			const low = localCenter - radius - 1, high = localCenter + radius + 1;
			const first = measured ? lowerBound(measured.centers, low) : Math.max(0, Math.min(length, Math.floor(low)));
			const end = measured ? lowerBound(measured.centers, high) : Math.max(0, Math.min(length, Math.ceil(high)));
			if (first < end) ranges.push([first, end]);
		}
		if (!ranges.length) return style(text);
		ranges.sort((a, b) => a[0] - b[0]);
		const offset = (index: number) => measured ? measured.offsets[index]! : index;
		let result = "";
		let run = "";
		let previous = style;
		let cursor = 0;
		const append = (text: string, next: TextStyler) => {
			if (next !== previous && run) {
				result += previous(run);
				run = "";
			}
			run += text;
			previous = next;
		};
		// At the loop seam two ranges may be lit, but the middle stays a bulk run.
		for (const [first, end] of ranges) {
			if (first > cursor) append(text.slice(offset(cursor), offset(first)), style);
			for (let index = Math.max(cursor, first); index < end; index++) {
				const cellCenter = measured ? measured.centers[index]! : index + 0.5;
				const position = column + direction * cellCenter;
				let distance = Infinity;
				for (const value of centers) distance = Math.min(distance, Math.abs(position - value));
				const strength = Math.max(0, Math.min(1, (1 - distance / radius) / 0.55));
				const smooth = strength * strength * (3 - 2 * strength);
				append(text.slice(offset(index), offset(index + 1)), styles.highlight(style, smooth));
			}
			cursor = Math.max(cursor, end);
		}
		if (cursor < length) append(text.slice(offset(cursor)), style);
		return result + (run ? previous(run) : style(""));
	};
}
